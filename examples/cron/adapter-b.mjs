// 定时任务域 · 实现 B：Map<`jobId#slot` → run> 天然去重，任务只存 lastSlot 游标。
//
// 与 A 的内部结构故意不同：A 是数组 + 已跑槽位 Set + nextDue 时间戳；
// B 不存「下一次什么时候」，每次 advance 都用算术从 lastSlot 推。
// 同一份案例两边必须判决一致——这正是「案例可移植」要验的东西。
import { validateManifest } from '../../src/adapter/contract.mjs';

export const MANIFEST = {
  adapter: 'cron-b',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  description: '定时任务调度（槽位键 Map，游标由 lastSlot 现算）',
  scopes: ['jobs', 'runs'],
  roles: ['operator', 'viewer'],
  // 没有独立的事件流：runs 这份列表本身就是观察。声明 true 等于谎称
  // 「事件记录完整」，event_absent 会据此判假——那是拿假前提判真结论。
  events_complete: false,
  canonical_view: 'agent-web/canonical-view',
  view: {
    version: 'agent-web/view/1',
    collections: {
      jobs: {
        kind: 'list',
        required: ['id', 'name', 'everyMinutes', 'startsAt', 'status', 'nextDueAt'],
        semantics: '本次运行创建的任务',
      },
      runs: {
        kind: 'list',
        required: ['id', 'jobId', 'scheduledFor', 'status'],
        semantics: '调度器实际跑过的槽位',
      },
    },
  },
  capabilities: [
    {
      id: 'job.create',
      kind: 'write',
      evidence_level: 'validated',
      roles: ['operator'],
      args: { name: 'string', everyMinutes: 'number', startsAt: 'ISO8601' },
      constraints: { everyMinutes: { min: 1, max: 1440, integer: true } },
    },
    { id: 'scheduler.advance', kind: 'write', evidence_level: 'validated', roles: ['operator'], args: { to: 'ISO8601' } },
    { id: 'job.pause', kind: 'write', evidence_level: 'validated', roles: ['operator'] },
    { id: 'job.resume', kind: 'write', evidence_level: 'validated', roles: ['operator'] },
    { id: 'jobs.list', kind: 'read', evidence_level: 'validated', roles: ['operator', 'viewer'] },
    { id: 'runs.list', kind: 'read', evidence_level: 'validated', roles: ['operator', 'viewer'] },
  ],
};

const clone = (v) => structuredClone(v);
const ms = (v) => {
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
const iso = (t) => new Date(t).toISOString();
const MIN = 60000;

export function createCronB() {
  const runs = new Map();
  let serial = 0;

  function blank(runId) {
    return { runId, jobs: new Map(), slotRuns: new Map(), nextJob: 1, nextRun: 1, clock: null };
  }

  // 下一次该跑的时刻：从 lastSlot 往后推一格。没有 lastSlot 就从 startsAt 算起。
  function nextDue(job) {
    if (job.lastSlot === null) return job.startsAt;
    return job.startsAt + (job.lastSlot + 1) * job.everyMinutes * MIN;
  }

  async function manifest() { return clone(MANIFEST); }

  async function reset() {
    serial += 1;
    const runId = `cron-b-${serial}`;
    runs.set(runId, blank(runId));
    return {
      runId,
      state: { jobs: [], runs: [] },
      roleBindings: { operator: `op-${serial}`, viewer: `view-${serial}` },
    };
  }

  async function observe(runId) {
    const run = runs.get(runId);
    if (!run) return { state: null, missingScopes: MANIFEST.scopes };
    const jobs = [...run.jobs.values()].map((j) => ({
      id: j.id,
      name: j.name,
      everyMinutes: j.everyMinutes,
      startsAt: iso(j.startsAt),
      status: j.status,
      nextDueAt: iso(nextDue(j)),
    }));
    const out = [...run.slotRuns.values()].map((r) => ({
      id: r.id,
      jobId: r.jobId,
      scheduledFor: iso(r.scheduledFor),
      status: r.status,
    }));
    return { state: { jobs, runs: out }, missingScopes: [] };
  }

  async function execute(runId, action) {
    const run = runs.get(runId);
    if (!run) return { outcome: 'infra_error', error: { code: 'no_run', message: 'run not found' } };
    const cap = MANIFEST.capabilities.find((c) => c.id === action.capability);
    const reject = (code, message) => ({ outcome: 'rejected', error: { code, message } });
    if (!cap) return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
    if (!cap.roles.includes(action.as)) return reject('forbidden', `${action.as} cannot ${action.capability}`);
    const args = action.arguments ?? {};

    if (action.capability === 'job.create') {
      const every = Number(args.everyMinutes);
      if (!Number.isInteger(every) || every < 1 || every > 1440) {
        return reject('invalid_argument', `everyMinutes 必须是 1..1440 的整数，收到 ${args.everyMinutes}`);
      }
      const startsAt = ms(args.startsAt);
      if (startsAt === null) return reject('invalid_argument', `startsAt 读不成时间：${args.startsAt}`);
      if (run.clock !== null && startsAt < run.clock) {
        return reject('invalid_argument', 'startsAt 不得早于当前调度时钟');
      }
      const id = run.nextJob++;
      run.jobs.set(id, {
        id,
        name: String(args.name ?? `job-${id}`),
        everyMinutes: every,
        startsAt,
        status: 'active',
        lastSlot: null,
      });
      if (run.clock === null) run.clock = startsAt;
      return { outcome: 'applied', identity: run.runId, payload: { jobId: id } };
    }

    if (action.capability === 'scheduler.advance') {
      const to = ms(args.to);
      if (to === null) return reject('invalid_argument', `to 读不成时间：${args.to}`);
      if (run.clock !== null && to < run.clock) {
        return reject('invalid_argument', `调度时钟只能向前：现在 ${iso(run.clock)}，要求退到 ${iso(to)}`);
      }
      const fired = [];
      for (const job of run.jobs.values()) {
        if (job.status !== 'active') continue;
        const step = job.everyMinutes * MIN;
        // 用算术直接算出「到 to 为止最后一个该跑的槽位」，不逐格循环。
        let k = job.lastSlot === null ? 0 : job.lastSlot + 1;
        while (job.startsAt + k * step <= to) {
          const key = `${job.id}#${k}`;
          if (!run.slotRuns.has(key)) {
            const at = job.startsAt + k * step;
            run.slotRuns.set(key, { id: run.nextRun++, jobId: job.id, scheduledFor: at, status: 'success' });
            fired.push(at);
          }
          job.lastSlot = k;
          k += 1;
        }
      }
      run.clock = to;
      return { outcome: 'applied', identity: run.runId, payload: { fired: fired.length } };
    }

    if (action.capability === 'job.pause' || action.capability === 'job.resume') {
      const job = run.jobs.get(Number(args.jobId));
      if (!job) return reject('job_not_found', `任务 ${args.jobId} 不存在`);
      job.status = action.capability === 'job.pause' ? 'paused' : 'active';
      if (job.status === 'active' && run.clock !== null) {
        // 恢复时把 lastSlot 推到「当前时钟所在的槽位」，欠下的槽位不补跑。
        const step = job.everyMinutes * MIN;
        const k = Math.ceil((run.clock - job.startsAt) / step);
        const last = Math.max(job.lastSlot === null ? -1 : job.lastSlot, k - 1);
        job.lastSlot = last;
      }
      return { outcome: 'applied', identity: run.runId, payload: { status: job.status } };
    }

    if (cap.kind === 'read') return { outcome: 'applied', identity: run.runId, payload: {} };
    return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
  }

  async function close(runId) { runs.delete(runId); }

  return { manifest, reset, observe, execute, close };
}

export function createAdapter() { return createCronB(); }
export function validateCronB() { return validateManifest(MANIFEST); }

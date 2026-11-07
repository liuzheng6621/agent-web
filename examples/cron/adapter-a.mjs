// 定时任务域 · 实现 A：数组 + 已完成槽位集合（doneSet），advance 时从游标逐槽补齐。
//
// 这个域存在的理由：前六个域里，时间是**被动的**（预约有时间段、凭证有有效期），
// 但没有一个域能表达「每隔 N 分钟必须跑一次」。count_delta 只数总数，
// 漏一个、多一个、漂一点三者全混成「数量不对」——那正是 recurrence 要分开的东西。
//
// 与 adapter-b 的内部结构故意不同：B 用 Map<slotIndex, run> 天然去重、游标推进；
// A 用数组 + Set。同一份案例两边必须判决一致。
import { validateManifest } from '../../src/adapter/contract.mjs';

export const MANIFEST = {
  adapter: 'cron-a',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  description: '定时任务调度（数组 + 槽位集合，逐槽补齐）',
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

export function createCronA() {
  const runs = new Map();
  let serial = 0;

  function blank(runId) {
    return {
      runId,
      jobs: new Map(),
      runs: [],
      done: new Set(), // `${jobId}#${slotIndex}`
      nextJob: 1,
      nextRun: 1,
      clock: null,
    };
  }

  async function manifest() { return clone(MANIFEST); }

  async function reset() {
    serial += 1;
    const runId = `cron-a-${serial}`;
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
      nextDueAt: iso(j.nextDue),
    }));
    const out = run.runs.map((r) => ({
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
        nextDue: startsAt,
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
      // 逐槽补齐：从每个任务的 nextDue 一路走到 to（含）。已完成的槽位不再跑。
      for (const job of run.jobs.values()) {
        if (job.status !== 'active') continue;
        const step = job.everyMinutes * MIN;
        let due = job.nextDue;
        let guard = 0;
        while (due <= to && guard < 100000) {
          guard += 1;
          const slot = Math.round((due - job.startsAt) / step);
          const key = `${job.id}#${slot}`;
          if (!run.done.has(key)) {
            run.done.add(key);
            run.runs.push({ id: run.nextRun++, jobId: job.id, scheduledFor: due, status: 'success' });
            fired.push(due);
          }
          due += step;
        }
        job.nextDue = due;
      }
      run.clock = to;
      return { outcome: 'applied', identity: run.runId, payload: { fired: fired.length } };
    }

    if (action.capability === 'job.pause' || action.capability === 'job.resume') {
      const job = run.jobs.get(Number(args.jobId));
      if (!job) return reject('job_not_found', `任务 ${args.jobId} 不存在`);
      job.status = action.capability === 'job.pause' ? 'paused' : 'active';
      // 恢复时把 nextDue 拉回当前时钟之后，别补跑暂停期间欠下的槽位：
      // 暂停的意思就是「这段时间不跑」，补跑等于把运维的决定撤销。
      if (job.status === 'active' && run.clock !== null && job.nextDue <= run.clock) {
        const step = job.everyMinutes * MIN;
        const k = Math.ceil((run.clock - job.startsAt) / step);
        job.nextDue = job.startsAt + k * step;
      }
      return { outcome: 'applied', identity: run.runId, payload: { status: job.status } };
    }

    if (cap.kind === 'read') return { outcome: 'applied', identity: run.runId, payload: {} };
    return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
  }

  async function close(runId) { runs.delete(runId); }

  return { manifest, reset, observe, execute, close };
}

export function createAdapter() { return createCronA(); }
export function validateCronA() { return validateManifest(MANIFEST); }

/**
 * 判据准入：一个断言凭什么被收下？
 *
 * 规则只有一条——
 *   如果去掉它，判决结果不变，那它就不该在案例里。
 *
 * 做法：拿正确实现 P+ 跑一遍当基准，再把 P+ 复制成若干个"只坏一处"的
 * 变异体逐条跑。断言 a 是变异体 m 的杀手，当且仅当
 *   a 在 P+ 上为真，在 m 上为假。
 * 为真的两种情况不吃：m 上仍然为真（抓不住）、m 上变成未知（说不出话）。
 *
 * 于是每个案例都得到一份可机械检查的「区分力证书」，
 * 而每个变异体是否有人管，也就有了明确答案。
 */
import { judge } from './runner.mjs';
import { evalAssertions } from './assert/index.mjs';
import { MUTATIONS, mutate } from './mutate.mjs';

const TRUE_STATUS = 'pass';

/** 记录型适配器：顺手存下每次 observe 的视图，用来还原每步的 stateAfter。 */
function recordingAdapter(inner) {
  const observes = [];
  const rec = {
    manifest: (...a) => inner.manifest(...a),
    reset: (...a) => inner.reset(...a),
    execute: (...a) => inner.execute(...a),
    async observe(runId, scopes) {
      const res = await inner.observe(runId, scopes);
      observes.push(res.state);
      return res;
    },
  };
  if (typeof inner.close === 'function') rec.close = (...a) => inner.close(...a);
  if (typeof inner.toStep === 'function') rec.toStep = (...a) => inner.toStep(...a);
  rec.__observes = observes;
  return rec;
}

export function flatAssertions(c) {
  const out = [];
  (c?.task?.goal_assertions ?? []).forEach((a, i) => out.push({ label: `goal[${i}]`, assertion: a }));
  (c?.task?.invariants ?? []).forEach((a, i) => out.push({ label: `inv[${i}]`, assertion: a }));
  return out;
}

/** 跑一条案例，并把每条断言单独求值的结果取回来。 */
export async function probe(caseObj, adapterImpl, { adapterName = 'unknown', timeoutMs } = {}) {
  const rec = recordingAdapter(adapterImpl);
  const verdict = await judge({ case: caseObj, adapter: rec, adapterName, timeoutMs });
  const ev = verdict?.evidence ?? null;
  const obs = rec.__observes;

  // runner 的观测节奏是：初始 1 次，每个执行过的步前后各 1 次，末尾 1 次。
  // 所以第 i 步的 stateAfter 落在 obs[2i+2]；中途 abort 时只还原跑过的那几步。
  const steps = (caseObj?.reference_trajectory ?? []).length;
  const done = Math.max(0, Math.floor((obs.length - 2) / 2));
  const traceOk = obs.length === 2 * done + 2 && done <= steps;
  const inner = traceOk ? Array.from({ length: done }, (_, i) => obs[2 * i + 2]) : [];

  const ctx = {
    initial: ev?.initial ?? obs[0],
    final: ev?.final ?? obs[obs.length - 1],
    trace: inner.map((state) => ({ stateAfter: state })),
    missingScopes: ev?.missing_scopes ?? [],
    events: ev?.events ?? [],
    eventsComplete: ev?.events_complete === true,
    eventsVocabulary: ev?.environment?.events_types ?? null,
  };

  const results = flatAssertions(caseObj).map(({ assertion }) => evalAssertions([assertion], ctx).results[0]);
  return { verdict, results, traceOk, observations: obs.length };
}

/** 一个案例上，所有变异体的杀伤矩阵。 */
export async function certifyCase(caseObj, adapterFactory, { adapterName = 'unknown', timeoutMs, mutations = MUTATIONS } = {}) {
  const base = await probe(caseObj, await adapterFactory(), { adapterName, timeoutMs });
  const armed = base.results.map((r) => r.status === 'true');
  const rows = [];

  for (const m of mutations) {
    const p = await probe(caseObj, m.wrap(await adapterFactory()), { adapterName, timeoutMs });
    const cells = p.results.map((r, i) => {
      if (!armed[i]) return 'unarmed';
      if (r.status === 'false') return 'killed';
      if (r.status === 'unknown') return 'blind';
      return 'survived';
    });
    rows.push({
      mutation: m.id,
      title: m.title,
      level: m.level,
      verdict: p.verdict.status,
      reason_code: p.verdict.reason_code,
      cells,
      baseSignature: sig(base.verdict),
      mutantSignature: sig(p.verdict),
      caseCaught: sig(base.verdict) !== sig(p.verdict),
    });
  }
  return { caseId: caseObj.id, base, armed, rows };
}

export function certificate(report) {
  const { assertions, mutations, summary } = report;
  const killed = assertions.filter((a) => a.kills.length > 0);
  return {
    ...report,
    minimal: greedyCover(killed),
    summary: { ...summary, armedAssertions: assertions.filter((a) => !a.unarmed).length, usefulAssertions: killed.length },
  };
}

function sig(v) {
  return `${v?.status ?? 'null'}/${v?.reason_code ?? 'null'}`;
}

function greedyCover(killed) {
  const want = new Set();
  for (const a of killed) for (const m of a.kills) want.add(m);
  const chosen = [];
  const covered = new Set();
  let guard = 0;
  while (covered.size < want.size && guard < 64) {
    guard += 1;
    let best = null;
    let gain = 0;
    for (const a of killed) {
      if (chosen.includes(a.key)) continue;
      const g = a.kills.filter((m) => !covered.has(m)).length;
      if (g > gain) { gain = g; best = a; }
    }
    if (!best || gain === 0) break;
    chosen.push(best.key);
    for (const m of best.kills) covered.add(m);
  }
  return { assertions: chosen, covers: [...covered], uncovered: [...want].filter((m) => !covered.has(m)) };
}

/** 跨案例汇总成一张矩阵：谁抓得住谁。 */
export async function certify({ cases, adapterFactory, adapterName = 'unknown', timeoutMs, mutations = MUTATIONS } = {}) {
  const per = [];
  for (const c of cases) {
    per.push(await certifyCase(c, adapterFactory, { adapterName, timeoutMs, mutations }));
  }

  const assertions = [];
  for (const cr of per) {
    flatAssertionsOf(cases, cr, assertions);
  }

  const mutationsSummary = mutations.map((m) => {
    const killedBy = [];
    const blindBy = [];
    const survivedIn = [];
    let verdictKills = 0;
    for (const cr of per) {
      const row = cr.rows.find((r) => r.mutation === m.id);
      if (!row) continue;
      flatAssertionsOf(cases, cr, []).forEach((meta, i) => {
        const cell = row.cells[i];
        const key = `${cr.caseId}#${meta.label}`;
        if (cell === 'killed') killedBy.push({ caseId: cr.caseId, assertion: key, kind: meta.kind });
        else if (cell === 'blind') blindBy.push(key);
        else if (cell === 'survived') survivedIn.push(key);
      });
      if (row.caseCaught) verdictKills += 1;
    }
    return { id: m.id, title: m.title, level: m.level, symptom: m.symptom, caught: killedBy.length > 0 || verdictKills > 0, killedBy, blindBy, survivedIn, verdictKills };
  });

  const caught = mutationsSummary.filter((m) => m.caught).length;
  const summary = {
    cases: per.length,
    mutations: mutations.length,
    caught,
    survived: mutations.length - caught,
    caughtRate: mutations.length === 0 ? null : caught / mutations.length,
  };
  const base = { version: 'agent-web/certify-1', adapter: adapterName, cases: per.map((p) => ({ caseId: p.caseId, verdict: p.base.verdict.status, traceOk: p.base.traceOk })), assertions, mutations: mutationsSummary, summary };
  return certificate(base);
}

function flatAssertionsOf(cases, cr, sink) {
  const c = cases.find((x) => x.id === cr.caseId);
  const list = flatAssertions(c);
  const out = [];
  list.forEach((meta, i) => {
    const kind = meta.assertion.kind;
    const row = cr.rows;
    const kills = row.filter((r) => r.cells[i] === 'killed').map((r) => r.mutation);
    const blind = row.filter((r) => r.cells[i] === 'blind').map((r) => r.mutation);
    const rec = { key: `${cr.caseId}#${meta.label}`, caseId: cr.caseId, label: meta.label, kind, unarmed: !cr.armed[i], kills, blind };
    out.push(rec);
    sink.push(rec);
  });
  return out;
}

export function certifyExit(report, { strict = false } = {}) {
  if (report.summary.survived > 0) return 1;
  if (strict && report.assertions.some((a) => !a.unarmed && a.kills.length === 0)) return 1;
  return 0;
}

export function formatCertify(report, { detail = false } = {}) {
  const L = [];
  const s = report.summary;
  L.push(`判据准入 · 适配器 ${report.adapter} · ${s.cases} 条案例 × ${s.mutations} 个变异体`);
  L.push('');

  L.push('变异体（实现能坏的方式）');
  const w = Math.max(...report.mutations.map((m) => m.id.length), 10);
  for (const m of report.mutations) {
    const mark = m.caught ? '抓到' : '漏网';
    const by = m.killedBy.map((k) => `${k.caseId}#${k.assertion.split('#')[1]}`).slice(0, 3).join(' ');
    const tail = m.caught ? by || `判决级 ×${m.verdictKills}` : '没有任何断言或负例步意识到它';
    L.push(`  [${mark}] ${m.id.padEnd(w)}  ${m.level.padEnd(7)}  ${tail}`);
  }
  L.push('');

  const armed = report.assertions.filter((a) => !a.unarmed);
  const useful = armed.filter((a) => a.kills.length > 0);
  L.push(`断言（${armed.length} 条能求值，其中 ${useful.length} 条真的能抓住东西）`);
  for (const a of armed) {
    const mark = a.kills.length > 0 ? '有效' : '空转';
    const tail = a.kills.length > 0 ? `杀死 ${a.kills.join(' ')}` : '去掉它判决不会变';
    L.push(`  [${mark}] ${a.key.padEnd(w + 18)} ${String(a.kind).padEnd(18)} ${tail}`);
  }
  const unarmed = report.assertions.length - armed.length;
  if (unarmed > 0) L.push(`  （另 ${unarmed} 条在正确实现上就不为真，不参与准入统计）`);
  L.push('');

  L.push('最小充分集（贪心覆盖全部被抓住的变异体）');
  L.push(`  ${report.minimal.assertions.length} 条：${report.minimal.assertions.join(' ') || '（空）'}`);
  if (report.minimal.uncovered.length > 0) L.push(`  覆盖不到：${report.minimal.uncovered.join(' ')}`);
  L.push('');

  const rate = s.caughtRate === null ? '—（分母为 0）' : `${(s.caughtRate * 100).toFixed(1)}%`;
  L.push(`变异体抓获率 ${s.caught}/${s.mutations} = ${rate}`);
  if (s.survived > 0) L.push(`漏网 ${s.survived} 个：${report.mutations.filter((m) => !m.caught).map((m) => m.id).join(' ')}`);

  if (detail) {
    L.push('');
    L.push('逐格明细（每行一个案例，每列一个变异体）');
    const ids = report.mutations.map((m) => m.id);
    for (const c of report.cases) {
      L.push(`  ${c.caseId}：判决 ${c.verdict}${c.traceOk ? '' : '（轨迹观测数不符，status_transition 可能失真）'}`);
      const idx = report.assertions.filter((a) => a.caseId === c.caseId);
      for (const a of idx) {
        const cells = ids.map((id) => {
          if (a.unarmed) return '·';
          if (a.kills.includes(id)) return 'K';
          if (a.blind.includes(id)) return '?';
          return '-';
        });
        L.push(`    ${a.label.padEnd(9)} ${String(a.kind).padEnd(18)} ${cells.join(' ')}`);
      }
    }
  }
  return L.join(String.fromCharCode(10));
}

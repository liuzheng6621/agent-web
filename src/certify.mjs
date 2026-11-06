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
import { stableStringify } from './values.mjs';

const TRUE_STATUS = 'pass';

/** 记录型适配器：顺手存下每次 observe 的视图，用来还原每步的 stateAfter。 */
function recordingAdapter(inner) {
  const observes = [];
  const executions = [];
  const rec = {
    manifest: (...a) => inner.manifest(...a),
    reset: (...a) => inner.reset(...a),
    // 返回体也要记：pagination 这类断言看的是「接口那一次返回了什么」，
    // 而证据里的 trace 为了不夹带业务数据，只留了 outcome/identity/error。
    async execute(runId, action) {
      const res = await inner.execute(runId, action);
      executions.push({ id: action?.id ?? null, capability: action?.capability ?? null, payload: res?.payload ?? null });
      return res;
    },
    async observe(runId, scopes) {
      const res = await inner.observe(runId, scopes);
      observes.push(res.state);
      return res;
    },
  };
  if (typeof inner.close === 'function') rec.close = (...a) => inner.close(...a);
  if (typeof inner.toStep === 'function') rec.toStep = (...a) => inner.toStep(...a);
  rec.__observes = observes;
  rec.__executions = executions;
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
    trace: inner.map((state, i) => ({
      stateAfter: state,
      // 第 i 步的执行返回；步没跑满（中途 abort）时后面没有，就该是 undefined
      payload: rec.__executions[i]?.payload ?? null,
    })),
    missingScopes: ev?.missing_scopes ?? [],
    events: ev?.events ?? [],
    eventsComplete: ev?.events_complete === true,
    eventsVocabulary: ev?.environment?.events_types ?? null,
  };

  const results = flatAssertions(caseObj).map(({ assertion }) => evalAssertions([assertion], ctx).results[0]);
  return { verdict, results, traceOk, observations: obs.length, ctx };
}

function dupValue(v) {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

/**
 * state 层变异体只改观测、不改执行：每一步的结局与正确实现完全相同，
 * 唯一不同的是 observe() 返回的规范视图被 tamper 过。
 *
 * 所以它的 ctx 不必靠重放整条轨迹得到——把 P⁺ 的 ctx 里每个快照复制一份、
 * 应用同一个 tamper，就得到变异体看到的 ctx。
 *
 * 等价性：变异体重放时第 i 次 observe 返回 tamper(clone(s_i))，s_i 是 P⁺
 * 第 i 次 observe 的返回值。wrapState 只包 observe，内部执行逻辑与 P⁺ 相同，
 * 因此它观察到的 s_i 序列与 P⁺ 逐项相同 ⇒ 两边 tamper 的输入相同、输出相同。
 * 前提是 tamper 为纯函数（变异体目录第 1 条要求：只坏一处、不留隐藏状态）。
 */
function transformCtx(baseCtx, tamper) {
  const ctx = {
    ...baseCtx,
    initial: dupValue(baseCtx.initial),
    final: dupValue(baseCtx.final),
    // 只换 stateAfter，其余字段（尤其是 payload）原样带过去。
    // 早先这里重建 trace 时把 payload 丢了，于是分页类断言在快路径上恒为 unknown，
    // 等价性门把「重放 true / 变换 unknown」当成不一致抓了出来。
    trace: (baseCtx.trace ?? []).map((t) => ({ ...t, stateAfter: dupValue(t.stateAfter) })),
  };
  // 传下标与总长：这样变异体才能只坏「中间某一步」——
  // 「中途坏掉、结尾修好」是现有断言全靠看不出来的那一类。
  const count = ctx.trace.length + 2;
  tamper(ctx.initial, 0, count);
  tamper(ctx.final, count - 1, count);
  for (let i = 0; i < ctx.trace.length; i += 1) tamper(ctx.trace[i].stateAfter, i + 1, count);
  return ctx;
}

/**
 * 执行结局与 P⁺ 相同时，判决只可能因断言结果而变：
 * 本来 pass 的，有 goal 断言变假 → fail/assertion_false；只剩不变量变假 → fail/invariant_violated。
 * 本来就不是 pass 的，结局没变，签名也不变。
 */
function deriveVerdict(baseVerdict, flat, results) {
  const status = baseVerdict?.status ?? 'unknown';
  if (status !== 'pass') return { status, reason_code: baseVerdict?.reason_code ?? null };
  let goalFailed = false;
  let invFailed = false;
  for (let i = 0; i < flat.length; i += 1) {
    if (results[i]?.status !== 'false') continue;
    if (String(flat[i].label).startsWith('inv')) invFailed = true;
    else goalFailed = true;
  }
  if (goalFailed) return { status: 'fail', reason_code: 'assertion_false' };
  if (invFailed) return { status: 'fail', reason_code: 'invariant_violated' };
  // pass 的前提是**所有断言都成立**。变异体把某个断言需要的事实删掉之后，
  // 那条断言会变成 unknown（看不见），此时判决必须是 unknown 而不是 pass——
  // 重放路径就是这么判的，快路径照抄这个语义才不会两边打架。
  // （m-drop-create-event 删掉 order.created 之后，timeliness 找不到起点事件）
  const blind = results.find((r) => r?.status === 'unknown');
  if (blind) return { status: 'unknown', reason_code: blind.code || 'missing_observation' };
  return { status: 'pass', reason_code: baseVerdict?.reason_code ?? null };
}

/** 不重放轨迹，直接用变换后的 ctx 求值断言。 */
export function fastProbe(caseObj, base, tamper) {
  const flat = flatAssertions(caseObj);
  const ctx = transformCtx(base.ctx, tamper);
  const results = flat.map(({ assertion }) => evalAssertions([assertion], ctx).results[0]);
  return {
    verdict: deriveVerdict(base.verdict, flat, results),
    results,
    traceOk: base.traceOk,
    observations: base.observations,
    ctx,
    reused: true,
  };
}

/**
 * 同一条案例跑两遍，差异路径就是「漂移」——自增 id、时间戳、取餐号、操作人。
 *
 * 这些东西在两次重放之间本来就会变，把它们算成「变异体留下的见证」，等于把
 * 编号增长当故障：真实后端上 certify 会凭空多出几条 killable，还会建议写
 * 「orders.0.id 等于 196」这种换个实现就红的断言。
 */
/**
 * 逐步对比每一步「执行之后的状态」。
 *
 * 没有这一层，只在终态上看得见的差异才叫见证，于是「中途坏、结尾修好」的变异体
 * （m-transient-*、m-approval-*）永远被判「说不清」——它确实坏了，只是收尾时又对了。
 */
export function traceDiff(a, b, budget = 200) {
  const out = [];
  const at = a && Array.isArray(a.trace) ? a.trace : [];
  const bt = b && Array.isArray(b.trace) ? b.trace : [];
  const n = Math.min(at.length, bt.length);
  for (let i = 0; i < n && out.length < budget; i += 1) {
    diffLeaves(at[i] && at[i].stateAfter, bt[i] && bt[i].stateAfter, 'trace.' + (i + 1), out, budget);
  }
  return out;
}

function driftPaths(a, b) {
  const set = new Set();
  if (!a || !b) return set;
  for (const w of diffLeaves(a.final, b.final, '', [], 400)) set.add(w.path);
  for (const w of diffLeaves(a.initial, b.initial, '', [], 200)) set.add('initial.' + w.path);
  for (const w of traceDiff(a, b, 400)) set.add(w.path);
  return set;
}

/** 一个案例上，所有变异体的杀伤矩阵。 */
export async function certifyCase(caseObj, adapterFactory, { adapterName = 'unknown', timeoutMs, mutations = MUTATIONS } = {}) {
  const base = await probe(caseObj, await adapterFactory(), { adapterName, timeoutMs });
  const armed = base.results.map((r) => r.status === 'true');
  const manifest = await (await adapterFactory()).manifest();
  // 先量一次漂移：把正确实现跑第二遍，两次之间本来就不一样的地方不算见证。
  const base2 = await probe(caseObj, await adapterFactory(), { adapterName, timeoutMs });
  const drift = driftPaths(base.ctx, base2.ctx);
  const rows = [];

  for (const m of mutations) {
    if (!appliesTo(m, manifest)) {
      rows.push({ mutation: m.id, title: m.title, layer: m.layer, notApplicable: true });
      continue;
    }
    // state 层变异体免重放：它只改观测，ctx 可以直接由 P⁺ 的 ctx 变换得到。
    // execute 层（换身份 / 改结局）改了执行，必须真的重放一遍整条轨迹。
    //
    // 唯一不能省的情况：base 是 unknown/missing_observation。这条 reason 在判决顺序表里
    // 出现两次（第 4 条在执行期、第 16 条在断言期），无法只凭代码区分；而第 16 条排在
    // assertion_false 之后，意味着断言变假时真判决会翻成 fail，fastProbe 推不出来。
    // 数量很少，直接退回重放。
    const wrapped = m.wrap(await adapterFactory());
    const reusable = process.env.AGENT_WEB_CERTIFY_SLOW !== '1'
      && m.layer === 'state'
      && typeof wrapped._agentWebStateFn === 'function'
      && !(base.verdict?.status === 'unknown' && base.verdict?.reason_code === 'missing_observation');
    const p = reusable
      ? fastProbe(caseObj, base, wrapped._agentWebStateFn)
      : await probe(caseObj, wrapped, { adapterName, timeoutMs });
    const cells = p.results.map((r, i) => {
      if (!armed[i]) return 'unarmed';
      if (r.status === 'false') return 'killed';
      if (r.status === 'unknown') return 'blind';
      return 'survived';
    });
    // 这个变异体在这条案例上留下了什么可观测差异？没有差异说明这条案例看不见它，
    // 有差异说明它一定杀得掉——只差一条还没写出来的断言。
    const witnesses = diffLeaves(base.ctx?.final, p.ctx?.final, '', [], 12)
      .concat(diffLeaves(base.ctx?.initial, p.ctx?.initial, 'initial.', [], 6))
      // 中途的差异也算见证：只比终态会把「中途坏、结尾修好」的一类整批漏掉
      .concat(traceDiff(base.ctx, p.ctx, 6))
      // 漂移路径剔除：同一实现跑两遍都会变的字段，不能拿来当「这个变异体被看见了」的证据。
      .filter((w) => !drift.has(w.path));
    const suggestions = [];
    for (const w of witnesses) {
      if (w.path.startsWith('initial.')) continue;
      const assertion = suggestFromWitness(w, base.ctx);
      if (!assertion) continue;
      const proof = verifySuggestion(assertion, base.ctx, p.ctx);
      if (proof.kills) suggestions.push({ assertion, proof, path: w.path });
    }
    rows.push({
      mutation: m.id,
      title: m.title,
      layer: m.layer,
      verdict: p.verdict.status,
      reason_code: p.verdict.reason_code,
      cells,
      baseSignature: sig(base.verdict),
      mutantSignature: sig(p.verdict),
      caseCaught: sig(base.verdict) !== sig(p.verdict),
      witness: witnesses[0] ?? null,
      witnessCount: witnesses.length,
      suggestions: suggestions.slice(0, 3),
      // 差异看得见、但全落在 id / 时间 / pickupNo 这类不可移植字段上：
      // 说明它杀得掉，只是没有能跨实现表达的断言。不记这一笔，读者会以为工具坏了。
      suggestionBlocked: suggestions.length === 0 && witnesses.length > 0,
    });
  }
  return { caseId: caseObj.id, base, armed, rows };
}

/** 把两份规范视图摊平，找出所有取值不同的叶子路径。 */
export function diffLeaves(a, b, prefix = '', out = [], budget = 200) {
  if (out.length >= budget) return out;
  const isObj = (v) => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b)) {
    if (stableStringify(a) !== stableStringify(b)) out.push({ path: prefix, correct: a, mutant: b });
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    diffLeaves(a?.[k], b?.[k], prefix === '' ? String(k) : prefix + '.' + k, out, budget);
    if (out.length >= budget) break;
  }
  return out;
}

const VIEW_COLLECTIONS = ['orders', 'menu', 'status_log'];

/**
 * 把一处可观测差异翻成一条断言。返回 null 表示没有现成模板能表达它。
 * 只翻"正确实现上一定为真、坏实现上一定为假"的那种——翻不出来就不猜。
 */
/**
 * 这些字段的值由「谁先跑」「库自增」「时钟」决定，跨实现断不了。
 *
 * 把它们建议成断言，写进去的人会得到一个必然失败（换实现就变）或必然空转
 * （同一个进程里恰好对上）的检查项 —— 比没有建议更糟，因为它看起来像条建议。
 */
const NON_PORTABLE = new Set([
  'id', 'ids', 'createTime', 'createdAt', 'updatedAt', 'updateTime',
  'at', 'time', 'timestamp', 'now', 'seq', 'oid', 'token',
  'pickupNo', 'username', 'by', 'operatorName', 'operatorRole',
]);

export function isPortablePath(path) {
  const last = String(path).split('.').pop();
  if (NON_PORTABLE.has(last)) return false;
  // createdAt / startAt / xxxTime 这类后缀一律算时钟或外部生成的
  if (/(At|Time|_at|_time)$/.test(last)) return false;
  return true;
}

export function appliesTo(meta, manifest) {
  const need = meta && meta.applies_to;
  if (!need) return true;
  const caps = new Set((manifest && manifest.capabilities || []).map((c) => c.id));
  const scopes = new Set(manifest && manifest.scopes || []);
  for (const c of need.capabilities || []) if (!caps.has(c)) return false;
  for (const s of need.collections || []) if (!scopes.has(s)) return false;
  return true;
}

export function suggestFromWitness(witness, baseCtx) {
  if (!isPortablePath(witness.path)) return null;
  // trace.3.xxx 是「第 3 步之后的状态」，只对这一条案例成立；要断言它得用 window/every_step，
  // 不是把步号写进 field_equals。这类见证照实报出来，但不给建议。
  if (String(witness.path).startsWith('trace.')) return null;
  const parts = String(witness.path).split('.');
  const collection = parts[0];
  if (!VIEW_COLLECTIONS.includes(collection)) return null;

  // orders.length 这种：用 count_delta 表达增量
  if (parts[1] === 'length') {
    const initLen = Array.isArray(baseCtx?.initial?.[collection]) ? baseCtx.initial[collection].length : null;
    if (initLen === null) return null;
    return { kind: 'count_delta', selector: { collection }, delta: witness.correct - initLen };
  }

  const index = Number(parts[1]);
  if (!Number.isInteger(index) || index < 0) return null;
  const path = parts.slice(2).join('.');
  if (path === '') return null;

  const selector = { collection, index };
  const value = witness.correct;
  if (value === undefined) return null;
  return { kind: 'field_equals', selector, path, value };
}

/** 拿一条候选断言到两个实现上各跑一遍，确认它真的是杀手。 */
export function verifySuggestion(assertion, baseCtx, mutantCtx) {
  const check = (ctx) => evalAssertions([assertion], ctx).results[0]?.status;
  const onBase = check(baseCtx);
  const onMutant = check(mutantCtx);
  return { onBase, onMutant, kills: onBase === 'true' && onMutant === 'false' };
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
      if (row.notApplicable) continue;
      flatAssertionsOf(cases, cr, []).forEach((meta, i) => {
        const cell = row.cells[i];
        const key = `${cr.caseId}#${meta.label}`;
        if (cell === 'killed') killedBy.push({ caseId: cr.caseId, assertion: key, kind: meta.kind });
        else if (cell === 'blind') blindBy.push(key);
        else if (cell === 'survived') survivedIn.push(key);
      });
      if (row.caseCaught) verdictKills += 1;
    }
    let anyApplicable = false;
    for (const cr of per) {
      const row = cr.rows.find((r) => r.mutation === m.id);
      if (row && !row.notApplicable) anyApplicable = true;
    }
    if (!anyApplicable) {
      return {
        id: m.id, title: m.title, layer: m.layer, symptom: m.symptom,
        caught: false, status: 'not_applicable',
        killedBy: [], blindBy: [], survivedIn: [], verdictKills: 0,
        witnessCount: 0, suggestionBlocked: false,
        witness: null, suggestion: null, suggestionCount: 0,
        equivalence: m.equivalence_evidence ?? null,
      };
    }

    const caught = killedBy.length > 0 || verdictKills > 0;

    // 三档状态：抓住 / 欠账（可杀，缺断言）/ 说不清（一条案例上都看不出差异）。
    // 「说不清」不等于「等价」——也可能只是案例根本没走到那段逻辑。要升成
    // equivalent，得由投稿人给出可区分性证明（meta.equivalence_evidence）。
    const witnesses = [];
    const suggestions = [];
    let blockedIn = 0;
    for (const cr of per) {
      const row = cr.rows.find((r) => r.mutation === m.id);
      if (!row) continue;
      if (row.notApplicable) continue;
      if (row.witness) witnesses.push({ caseId: cr.caseId, ...row.witness });
      if (row.suggestionBlocked) blockedIn += 1;
      for (const sg of row.suggestions) suggestions.push({ caseId: cr.caseId, path: sg.path, assertion: sg.assertion, proof: sg.proof });
    }
    const status = caught ? 'caught' : suggestions.length > 0 ? 'killable' : witnesses.length > 0 ? 'killable' : 'undetermined';
    return {
      id: m.id,
      title: m.title,
      layer: m.layer,
      symptom: m.symptom,
      caught,
      status,
      killedBy,
      blindBy,
      survivedIn,
      verdictKills,
      witnessCount: witnesses.length,
      suggestionBlocked: blockedIn > 0 && suggestions.length === 0,
      witness: witnesses[0] ?? null,
      suggestion: suggestions[0] ?? null,
      suggestionCount: suggestions.length,
      equivalence: m.equivalence_evidence ?? null,
    };
  });

  const applicable = mutationsSummary.filter((m) => m.status !== 'not_applicable').length;
  const caught = mutationsSummary.filter((m) => m.caught).length;
  const killable = mutationsSummary.filter((m) => m.status === 'killable').length;
  const undetermined = mutationsSummary.filter((m) => m.status === 'undetermined').length;
  const summary = {
    cases: per.length,
    mutations: mutations.length,
    applicable,
    notApplicable: mutations.length - applicable,
    caught,
    survived: applicable - caught,
    killable,
    undetermined,
    suggestions: mutationsSummary.reduce((n, m) => n + (m.caught ? 0 : m.suggestionCount), 0),
    caughtRate: applicable === 0 ? null : caught / applicable,
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
    const kills = row.filter((r) => r.cells && r.cells[i] === 'killed').map((r) => r.mutation);
    const blind = row.filter((r) => r.cells && r.cells[i] === 'blind').map((r) => r.mutation);
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

/** 把所有建议断言吐成可直接粘进案例的 JSON（按案例分组）。 */
export function formatSuggestions(report) {
  const byCase = new Map();
  for (const m of report.mutations) {
    if (m.caught || !m.suggestion) continue;
    const key = m.suggestion.caseId;
    if (!byCase.has(key)) byCase.set(key, []);
    byCase.get(key).push({ mutant: m.id, path: m.suggestion.path, assertion: m.suggestion.assertion });
  }
  const out = [];
  for (const [caseId, rows] of byCase) {
    out.push(`// ${caseId}（${rows.length} 条，每条都已验证能杀死对应变异体）`);
    for (const r of rows) {
      out.push(`//   杀死 ${r.mutant}  ← 差异在 ${r.path}`);
      out.push('   ' + stableStringify(r.assertion) + ',');
    }
    out.push('');
  }
  const blocked = (report.mutations ?? []).filter((m) => !m.caught && m.suggestionBlocked);
  if (blocked.length > 0) {
    out.push('// 以下变异体杀得掉，但差异全落在不可移植字段上（id / 时间 / 取餐号这类），');
    out.push('// 没有能跨实现表达的断言 —— 换一个实现它就必然失败，写进去等于给自己造一条会红的假账：');
    for (const m of blocked) out.push('//   ' + m.id + (m.witness ? '  ← ' + m.witness.path : ''));
    out.push('');
  }
  return out.join(String.fromCharCode(10)).replace(/,\s*$/, '');
}

export function formatCertify(report, { detail = false } = {}) {
  const L = [];
  const s = report.summary;
  L.push(`判据准入 · 适配器 ${report.adapter} · ${s.cases} 条案例 × ${s.mutations} 个变异体`);
  L.push('');

  L.push('变异体（实现能坏的方式）');
  const w = Math.max(...report.mutations.map((m) => m.id.length), 10);
  for (const m of report.mutations) {
    const mark = m.caught ? '抓到' : m.status === 'killable' ? '欠账' : m.status === 'not_applicable' ? '不适用' : '说不清';
    const by = m.killedBy.map((k) => `${k.caseId}#${k.assertion.split('#')[1]}`).slice(0, 3).join(' ');
    let tail;
    if (m.caught) tail = by || `判决级 ×${m.verdictKills}`;
    else if (m.status === 'killable') tail = `可杀，缺断言（${m.witnessCount} 处可观测差异）`;
    else if (m.status === 'not_applicable') tail = '该适配器没有它声明的能力或集合';
    else tail = m.equivalence ? `说不清（投稿人声称等价：${m.equivalence}）` : '一条案例上都看不出差异——可能等价，也可能案例没走到';
    L.push(`  [${mark}] ${m.id.padEnd(w)}  ${String(m.layer).padEnd(7)}  ${tail}`);
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
  L.push(`变异体抓获率 ${s.caught}/${s.applicable} = ${rate}（目录共 ${s.mutations} 个，${s.notApplicable} 个不适用）`);
  if (s.survived > 0) L.push(`漏网 ${s.survived} 个：${report.mutations.filter((m) => !m.caught && m.status !== 'not_applicable').map((m) => m.id).join(' ')}`);
  if (s.killable > 0) L.push(`  其中 ${s.killable} 个已被证明杀得掉，只差断言没写`);
  if (s.undetermined > 0) L.push(`  其中 ${s.undetermined} 个连差异都造不出来——先别急着补断言，先确认案例走没走到`);
  const notApplicable = report.mutations.filter((m) => m.status === 'not_applicable').map((m) => m.id);
  if (notApplicable.length > 0) L.push(`不适用 ${notApplicable.length} 个：${notApplicable.join(' ')}（声明了能力或集合，这个适配器没有——不算漏网）`);

  const withSuggestion = report.mutations.filter((m) => !m.caught && m.suggestion);
  if (withSuggestion.length > 0) {
    L.push('');
    L.push('建议断言（已在这两个实现上验过：正确实现为真、坏实现为假）');
    for (const m of withSuggestion) {
      L.push(`  ${m.id}`);
      L.push(`    案例 ${m.suggestion.caseId}  差异在 ${m.suggestion.path}`);
      L.push(`    ${stableStringify(m.suggestion.assertion)}`);
    }
    if (s.suggestions > withSuggestion.length) {
      L.push(`  （还有 ${s.suggestions - withSuggestion.length} 条备选，用 --suggest 看全部）`);
    }
  }

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

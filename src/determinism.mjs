/**
 * determinism —— 判决指纹与批次不变性门
 *
 * 起因是 L9：并发跑批时同一个变异体从「被第 4 条断言抓住」变成「判决级 ×3」，
 * 串行连跑两次却逐字相同。当时只有一句散文记着这件事，没有任何机器门能证明
 * 「现在这次并行和串行是同一件事」。
 *
 * 这个模块只做两件事：
 *
 *   1) 把一次判决压成指纹 —— 判什么（status / reason_code）、死在哪条断言
 *      （断言序号 + kind + 三值 + 代码）、每一步的实际结局（capability / outcome / 错误码）。
 *   2) 比对两次指纹，逐条给出差异路径。
 *
 * 为什么不直接 diff 整个 evidence：真实后端的 createTime / updatedAt 每次都不一样，
 * 把时间戳算进指纹，门就永远是红的，人就会去关掉它。所以默认只比「判决相关的投影」；
 * 需要更严的场合用 --strict，它额外把 detail 和去掉易变字段后的 evidence 也算进去。
 *
 * 这一层借的是 DeepInfer 的做法（tests/models/test_batch_invariant.py）：他们的批次不变性
 * 断言不是「两次输出文本一样」，而是 token_ids + logprobs + top-k 逐位相同 ——
 * 结论一致不等于过程一致，中间任何一处不同都算漂移。这里的等价物是
 * 「判决 + 死因 + 逐步回执」，不是「都 pass 了」。
 */

import crypto from 'node:crypto';

/** 易变字段：时间戳与耗时，不进严格指纹。 */
const VOLATILE = new Set(['finished_at', 'timing_ms', 'duration_ms', 'stack', 'started_at']);

/** 键排序后再序列化：同一个对象不同构造顺序不该产生不同指纹。 */
export function stableStringify(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (VOLATILE.has(k)) continue;
        out[k] = walk(v[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** 断言结果只留判定身份，不留正文：正文里的值会随数据变，但「哪条断言、判了什么」不该变。 */
function assertionShape(results) {
  return (results || []).map((r, i) => ({
    index: i,
    kind: r && r.kind ? r.kind : null,
    status: r && r.status ? r.status : null,
    code: r && r.code ? r.code : null,
  }));
}

/**
 * 把一条判决压成指纹。
 * @param {object} verdict judge() 的返回
 * @param {{strict?: boolean}} [opts]
 */
export function fingerprintVerdict(verdict, opts = {}) {
  const v = verdict || {};
  const trace = Array.isArray(v.evidence && v.evidence.trace) ? v.evidence.trace : [];
  const fp = {
    case_id: v.case_id ?? null,
    status: v.status ?? null,
    reason_code: v.reason_code ?? null,
    stage: v.stage ?? null,
    goals: assertionShape(v.goal_results),
    invariants: assertionShape(v.invariant_results),
    failed: (v.failed_assertions || []).map((r) => ({
      kind: r && r.kind ? r.kind : null,
      status: r && r.status ? r.status : null,
      code: r && r.code ? r.code : null,
    })),
    trace: trace.map((t) => ({
      index: t.index ?? null,
      capability: t.capability ?? null,
      as: t.as ?? null,
      expected_outcome: t.expected_outcome ?? null,
      outcome: t.outcome ?? null,
      error: t.error && t.error.code ? t.error.code : null,
    })),
  };
  if (opts.strict) {
    fp.detail = v.detail ?? null;
    fp.evidence_sha256 = sha256(stableStringify(v.evidence ?? null));
  }
  return fp;
}

/** 一批判决 → 稳定排序的指纹清单。 */
export function fingerprintAll(verdicts, opts = {}) {
  return (verdicts || [])
    .map((v) => fingerprintVerdict(v, opts))
    .sort((a, b) => String(a.case_id).localeCompare(String(b.case_id)));
}

function flatten(value, prefix = '', out = new Map()) {
  if (value === null || typeof value !== 'object') {
    out.set(prefix || '<root>', value);
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) out.set(prefix || '<root>', []);
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) out.set(prefix || '<root>', {});
  for (const k of keys.sort()) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/**
 * 比对两份指纹清单，返回逐条差异。
 * @returns {Array<{case_id: string, kind: 'missing'|'extra'|'changed', path?: string, before?: any, after?: any}>}
 */
export function diffFingerprints(before, after) {
  const b = new Map((before || []).map((x) => [x.case_id, x]));
  const a = new Map((after || []).map((x) => [x.case_id, x]));
  const ids = [...new Set([...b.keys(), ...a.keys()])].sort();
  const diffs = [];
  for (const id of ids) {
    if (!b.has(id)) { diffs.push({ case_id: id, kind: 'extra' }); continue; }
    if (!a.has(id)) { diffs.push({ case_id: id, kind: 'missing' }); continue; }
    const fb = flatten(b.get(id));
    const fa = flatten(a.get(id));
    for (const path of [...new Set([...fb.keys(), ...fa.keys()])].sort()) {
      const vb = fb.has(path) ? fb.get(path) : '<absent>';
      const va = fa.has(path) ? fa.get(path) : '<absent>';
      if (stableStringify(vb) !== stableStringify(va)) {
        diffs.push({ case_id: id, kind: 'changed', path, before: vb, after: va });
      }
    }
  }
  return diffs;
}

export function formatDeterminismReport(diffs, { cases = 0, strict = false } = {}) {
  const mode = strict ? '严格（含 detail 与 evidence 摘要）' : '判决投影（status / 死因 / 逐步回执）';
  if (diffs.length === 0) {
    return `批次不变性：${cases} 条案例指纹逐字一致（${mode}）。`;
  }
  const lines = [`批次不变性：${diffs.length} 处漂移（${mode}）。`];
  for (const d of diffs) {
    if (d.kind === 'missing') lines.push(`  ✗ ${d.case_id}：这一轮没有产出判决`);
    else if (d.kind === 'extra') lines.push(`  ✗ ${d.case_id}：这一轮多出判决`);
    else lines.push(`  ✗ ${d.case_id} · ${d.path}：${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`);
  }
  return lines.join('\n');
}

/** 指纹清单落盘格式。 */
export function manifestOf(fingerprints, meta = {}) {
  return {
    schema_version: 'agent-web/determinism/0.1',
    note: '判决指纹清单。串行与并发两种跑法、或两次独立进程，必须产出逐字相同的这一份。',
    ...meta,
    cases: fingerprints.length,
    fingerprints,
  };
}

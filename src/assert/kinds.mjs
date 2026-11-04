/**
 * 七种断言的求值实现。
 *
 * 共同的 ctx：
 *   initial         state_0
 *   final           终态
 *   trace           [{ index, action, outcome, stateBefore, stateAfter }]
 *   events          事件流（可能不完整）
 *   eventsComplete  events 是否为「声明完整」的记录
 *   missingScopes   适配器报告的未观测作用域
 *
 * 每个求值器返回 { status, code, message }：
 *   code     机器可读的短码，进入报告聚合
 *   message  人话，必须能独立复述「哪一条、为什么」
 */

import { TRUE, FALSE, UNKNOWN, and, or, not } from '../three-valued.mjs';
import { selectEntities, describeSelector } from '../select.mjs';
import { getPath, deepEqual, fingerprint } from '../values.mjs';

const ok = (status, code, message) => ({ status, code, message });

function guardSelector(spec, ctx) {
  const sel = selectEntities(ctx.final, spec);
  if (sel.status === 'missing') {
    return { blocked: ok(UNKNOWN, 'missing_observation', sel.reason) };
  }
  if (sel.status === 'invalid') {
    return { blocked: ok(UNKNOWN, 'invalid_case', sel.reason) };
  }
  return { sel };
}

export function entity_exists(a, ctx) {
  const g = guardSelector(a.selector, ctx);
  if (g.blocked) return g.blocked;
  const { sel } = g;
  const min = a.min ?? 1;
  const max = a.max;
  const n = sel.total;
  const pass = n >= min && (max === undefined || n <= max);
  const cond = max === undefined ? `>= ${min}` : `in [${min}, ${max}]`;
  return ok(
    pass ? TRUE : FALSE,
    pass ? 'ok' : 'entity_not_found',
    `${describeSelector(a.selector)} 命中 ${n} 条（期望 ${cond}）`,
  );
}

export function field_equals(a, ctx) {
  const g = guardSelector(a.selector, ctx);
  if (g.blocked) return g.blocked;
  const { sel } = g;
  if (sel.total === 0) {
    return ok(FALSE, 'entity_not_found', `${describeSelector(a.selector)} 无匹配实体，字段无从比较`);
  }
  if (sel.rows.length !== 1) {
    return ok(
      UNKNOWN,
      'invalid_case',
      `标量选择器命中 ${sel.rows.length} 条，字段 ${a.path} 的取值不唯一`,
    );
  }
  const actual = getPath(sel.rows[0], a.path);
  const pass = deepEqual(actual, a.value);
  return ok(
    pass ? TRUE : FALSE,
    pass ? 'ok' : 'field_mismatch',
    pass
      ? `${a.path} = ${JSON.stringify(actual)}`
      : `${a.path} 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(a.value)}`,
  );
}

export function count_delta(a, ctx) {
  const ini = selectEntities(ctx.initial, a.selector);
  const fin = selectEntities(ctx.final, a.selector);
  if (ini.status !== 'ok' || fin.status !== 'ok') {
    return ok(
      UNKNOWN,
      'missing_observation',
      `初态或终态的 ${a.selector.collection} 不可观测`,
    );
  }
  const delta = fin.total - ini.total;
  if (a.delta !== undefined) {
    const pass = delta === a.delta;
    return ok(
      pass ? TRUE : FALSE,
      pass ? 'ok' : 'count_mismatch',
      `${describeSelector(a.selector)} 变化 ${delta}（期望 ${a.delta}）`,
    );
  }
  const lo = a.min ?? -Infinity;
  const hi = a.max ?? Infinity;
  const pass = delta >= lo && delta <= hi;
  return ok(
    pass ? TRUE : FALSE,
    pass ? 'ok' : 'count_mismatch',
    `${describeSelector(a.selector)} 变化 ${delta}（期望 [${lo}, ${hi}]）`,
  );
}

function sequenceOf(ctx, spec, path) {
  const raw = [];
  for (const step of ctx.trace) {
    const sel = selectEntities(step.stateAfter, spec);
    if (sel.status !== 'ok' || sel.total === 0) continue;
    const v = getPath(sel.rows[0], path);
    if (v === undefined) continue;
    raw.push(v);
  }
  return raw.filter((v, i) => i === 0 || v !== raw[i - 1]);
}

export function status_transition(a, ctx) {
  const path = a.path ?? 'status';
  const seq = sequenceOf(ctx, a.selector, path);
  if (seq.length === 0) {
    return ok(
      UNKNOWN,
      'missing_observation',
      `${describeSelector(a.selector)} 在轨迹中从未被观测到（无法取得 ${path} 序列）`,
    );
  }

  if (Array.isArray(a.transitions)) {
    const edges = new Set();
    for (let i = 1; i < seq.length; i += 1) edges.add(`${seq[i - 1]}=>${seq[i]}`);
    const missing = a.transitions.filter(([from, to]) => !edges.has(`${from}=>${to}`));
    if (missing.length > 0) {
      return ok(
        FALSE,
        'transition_missing',
        `缺少迁移 ${missing.map(([f, t]) => `${f}=>${t}`).join(', ')}；实际 ${seq.join(' -> ')}`,
      );
    }
    return ok(TRUE, 'ok', `迁移齐全：${seq.join(' -> ')}`);
  }

  if (Array.isArray(a.sequence)) {
    let i = 0;
    for (const v of seq) {
      if (i < a.sequence.length && v === a.sequence[i]) i += 1;
    }
    const pass = i === a.sequence.length;
    return ok(
      pass ? TRUE : FALSE,
      pass ? 'ok' : 'transition_missing',
      pass
        ? `状态序列包含 ${a.sequence.join(' -> ')}`
        : `实际序列 ${seq.join(' -> ')}，未按序包含 ${a.sequence.join(' -> ')}`,
    );
  }

  return ok(UNKNOWN, 'invalid_case', 'status_transition 需要 transitions 或 sequence 之一');
}

export function unchanged(a, ctx) {
  const scopes = Array.isArray(a.scopes) ? a.scopes : [a.scope];
  if (scopes.length === 0 || scopes.some((s) => typeof s !== 'string')) {
    return ok(UNKNOWN, 'invalid_case', 'unchanged 需要非空的 scopes 字符串数组');
  }
  const missing = scopes.filter(
    (s) => getPath(ctx.initial, s) === undefined || getPath(ctx.final, s) === undefined,
  );
  if (missing.length > 0) {
    return ok(UNKNOWN, 'missing_observation', `作用域 ${missing.join(', ')} 首尾不全`);
  }
  for (const s of scopes) {
    const before = fingerprint(getPath(ctx.initial, s));
    const after = fingerprint(getPath(ctx.final, s));
    if (before !== after) {
      return ok(FALSE, 'side_effect', `${s} 语义指纹 ${before} -> ${after}`);
    }
  }
  return ok(TRUE, 'ok', `${scopes.join(', ')} 净变化为零`);
}

export function event_absent(a, ctx) {
  // 词表优先于完整性：应用压根不记录的类型，不能因为查不到就判 TRUE。
  if (typeof a.type === 'string' && Array.isArray(ctx.eventsVocabulary) && !ctx.eventsVocabulary.includes(a.type)) {
    return ok(
      UNKNOWN,
      'unsupported_event',
      '适配器未声明记录事件类型 ' + a.type + '（manifest.events_types 不含它），无法据此判断',
    );
  }
  if (!ctx.eventsComplete) {
    return ok(UNKNOWN, 'incomplete_observation', '事件记录未声明完整，无法证明中间没有发生该事件');
  }
  const hits = ctx.events.filter((e) => {
    if (a.type !== undefined && getPath(e, 'type') !== a.type) return false;
    if (Array.isArray(a.where) && !a.where.every((p) => deepEqual(getPath(e, p.field), p.eq))) {
      return false;
    }
    return true;
  });
  return ok(
    hits.length === 0 ? TRUE : FALSE,
    hits.length === 0 ? 'ok' : 'event_observed',
    hits.length === 0
      ? `未观察到 ${a.type ?? '(任意)'} 事件`
      : `观察到 ${hits.length} 条禁止事件，首条 ${JSON.stringify(hits[0])}`,
  );
}

export function composite(a, ctx, recurse) {
  const args = a.args;
  if (!Array.isArray(args) || args.length === 0) {
    return ok(UNKNOWN, 'invalid_case', 'composite 需要非空 args');
  }
  const evaluated = args.map((sub) => recurse(sub, ctx));
  if (a.op === 'not') {
    if (evaluated.length !== 1) {
      return ok(UNKNOWN, 'invalid_case', 'composite.not 必须恰好一个参数');
    }
    const inner = evaluated[0];
    const status = not(inner.status);
    return ok(
      status,
      inner.code === 'ok' ? (status === TRUE ? 'ok' : 'negated') : inner.code,
      `not(${inner.message}) -> ${status}`,
    );
  }
  const statuses = evaluated.map((e) => e.status);
  if (a.op === 'and') {
    const status = and(...statuses);
    const first = evaluated.find((e) => e.status === status) ?? evaluated[0];
    return ok(status, status === TRUE ? 'ok' : first.code, first.message);
  }
  if (a.op === 'or') {
    const status = or(...statuses);
    return ok(
      status,
      status === TRUE ? 'ok' : evaluated[0].code,
      evaluated.map((e) => e.message).join(' | '),
    );
  }
  return ok(UNKNOWN, 'invalid_case', `composite.op 不支持 ${a.op}`);
}

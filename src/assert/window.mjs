// 时间窗与每步求值。
//
// 为什么需要它们：`unchanged` / `count_delta` 只看首尾，`status_transition` 只看状态序列。
// 有一类故障刚好躲在这两者之间 —— 中途坏掉、结尾修好；或者「被拒绝的那一步之后
// 悄悄留了半条记录，最后又清掉」。净变化为零，终态干净，现有断言全都判 TRUE。
//
// 这两种断言不是「更严格」，是「换个观察口」：window 缩时间，every_step 缩间隔。

import { TRUE, FALSE, UNKNOWN, and } from '../three-valued.mjs';

/** window 里允许出现的断言：它们都能在「一小段状态」上独立求值。 */
export const WINDOW_INNER = Object.freeze(['unchanged', 'count_delta', 'field_equals', 'entity_exists']);

const MAX_STEPS = 10000;

function traceOf(ctx) {
  return Array.isArray(ctx.trace) ? ctx.trace : [];
}

function stateAt(ctx, i) {
  const tr = traceOf(ctx);
  if (i <= 0) return ctx.initial;
  if (i > tr.length) return ctx.final;
  const t = tr[i - 1];
  return t && t.stateAfter !== undefined ? t.stateAfter : undefined;
}

function bad(msg) {
  return { status: UNKNOWN, code: 'invalid_case', message: msg };
}

/**
 * `{kind:'window', from_step, to_step, of}`：
 * 用 [from_step, to_step) 这一段的状态当「初态/终态」重跑一次内层断言。
 * step 编号按「第几次写操作」，0 是起点。
 */
export function window(a, ctx, evalFn) {
  const tr = traceOf(ctx);
  const total = tr.length;
  const from = a.from_step === undefined ? 0 : a.from_step;
  const to = a.to_step === undefined ? total : a.to_step;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return bad('window 的 from_step / to_step 必须是整数');
  if (from < 0 || to > total || to <= from) {
    return bad(`window 的区间 [${from}, ${to}) 不合法（本次一共 ${total} 步）`);
  }
  const before = stateAt(ctx, from);
  const after = stateAt(ctx, to);
  if (before === undefined || after === undefined) {
    return { status: UNKNOWN, code: 'missing_observation', message: `第 ${from}~${to} 步的状态没被记录` };
  }
  const sub = {
    ...ctx,
    initial: before,
    final: after,
    // 内层若还要 trace（当前不允许），给一段切片；留在这里是为了将来放开时不用改结构
    trace: tr.slice(from, to).map((t) => ({ ...t, stateAfter: t.stateAfter })),
  };
  const r = evalFn(a.of, sub);
  if (r.status === TRUE) {
    return { status: TRUE, code: 'ok', message: `第 ${from}~${to} 步之间满足 ${a.of.kind}` };
  }
  return {
    status: r.status,
    code: r.code,
    message: `第 ${from}~${to} 步之间 ${a.of.kind} 不成立：${r.message}`,
    at_step: from,
  };
}

/**
 * `{kind:'every_step', of}`：
 * 每走完一步就用「起点 → 这一步之后」重跑内层断言。
 * 任何一步 FALSE 就 FALSE；否则有 UNKNOWN 就 UNKNOWN。
 *
 * 语义选择：内层是以**起点**为参照，不是以「上一步」为参照 ——
 * 否则「每步都变了」的东西永远判不了。
 */
export function everyStep(a, ctx, evalFn) {
  const tr = traceOf(ctx);
  const total = tr.length;
  if (total === 0) {
    return { status: UNKNOWN, code: 'missing_observation', message: '没有记录到任何一步，every_step 无从求值' };
  }
  if (total > MAX_STEPS) return bad(`步数 ${total} 超过上限 ${MAX_STEPS}`);
  const results = [];
  for (let k = 1; k <= total; k += 1) {
    const after = stateAt(ctx, k);
    if (after === undefined) {
      results.push({ k, status: UNKNOWN, code: 'missing_observation', message: `第 ${k} 步的状态没被记录` });
      continue;
    }
    const r = evalFn(a.of, { ...ctx, initial: ctx.initial, final: after });
    results.push({ k, ...r });
  }
  const firstBad = results.find((r) => r.status === FALSE);
  if (firstBad) {
    return {
      status: FALSE,
      code: firstBad.code,
      message: `第 ${firstBad.k} 步之后 ${a.of.kind} 就不成立了：${firstBad.message}`,
      at_step: firstBad.k,
    };
  }
  const unknown = results.find((r) => r.status === UNKNOWN);
  if (unknown) {
    return { status: UNKNOWN, code: unknown.code, message: `第 ${unknown.k} 步判不了：${unknown.message}`, at_step: unknown.k };
  }
  const status = and(...results.map((r) => r.status));
  return { status, code: status === TRUE ? 'ok' : 'unknown', message: `${total} 步每一步都满足 ${a.of.kind}` };
}

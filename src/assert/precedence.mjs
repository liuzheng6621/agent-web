// precedence：流水行之间的**相对顺序**约束 —— 「这些事件必须按这个先后出现」。
//
// 为什么必须单独一种 kind：
//   status_transition.sequence 跟着**一个实体**的 status 字段跨步走，说不出
//   「流水集合里 row A 必须在 row B 之前」；state_machine(walk=rows) 只判
//   **走过的边合不合法**，不判「该出现的是否按序出现」；sorted_by 只判
//   **一个单调列**（时间戳），说不出两个不同 type 的相对先后；
//   field_equals 钉的是**绝对下标**——流水前面多插一行（别的订单、系统行）
//   它就误报。「先发货后扣款」「先 ready 后 making」这类坏法只有相对序能说。
//
// 语义：expect 里的每个事件按顺序在流水行里做**贪心子序列匹配**（允许中间
// 夹别的行）；前一个匹配位置之后找不到下一个事件 → 判假。区分两种失败：
//   precedence_missing   整条流水里都没有这个事件（「被跳过」）
//   precedence_inverted  事件存在，但只出现在已推进位置之前（「顺序反了」）
//
// 三条硬边界（与 timeliness/event_absent 同一口径）：
//   1. 集合不可观测 → unknown/missing_observation，不判假
//   2. 缺必需事件 → 判假（这是行为缺席，与 status_transition.sequence 同判法）
//   3. 匹配只看 type 与可选的 field/value，不做任何时间推断

const TRUE = 'true';
const FALSE = 'false';
const UNKNOWN = 'unknown';
const ok = (status, code, message) => ({ status, code, message });

function rowMatches(row, spec) {
  if (!row || typeof row !== 'object') return false;
  if (spec.type !== undefined && row.type !== spec.type) return false;
  if (spec.field !== undefined && spec.value !== undefined && row[spec.field] !== spec.value) return false;
  return true;
}

/**
 * @param {object} a  断言 { collection?, expect: [{type, field?, value?}, ...] }
 * @param {object} ctx 求值上下文（final 视图）
 */
export function precedence(a, ctx) {
  const view = ctx && ctx.final;
  if (!view || typeof view !== 'object') {
    return ok(UNKNOWN, 'missing_observation', '没有终态视图，看不到事件行');
  }
  const collection = a.collection ?? 'status_log';
  const rows = view[collection];
  if (!Array.isArray(rows)) {
    return ok(UNKNOWN, 'missing_observation', `视图里没有 ${collection} 这个集合，看不到事件行`);
  }
  const expect = a.expect;
  let cursor = 0;
  for (let k = 0; k < expect.length; k += 1) {
    const spec = expect[k];
    let found = -1;
    for (let i = cursor; i < rows.length; i += 1) {
      if (rowMatches(rows[i], spec)) { found = i; break; }
    }
    if (found >= 0) {
      cursor = found + 1;
      continue;
    }
    const anywhere = rows.findIndex((r) => rowMatches(r, spec));
    if (anywhere < 0) {
      return ok(FALSE, 'precedence_missing',
        `缺少事件 ${JSON.stringify(spec)}：整条流水里都没有（被跳过）`);
    }
    return ok(FALSE, 'precedence_inverted',
      `事件 ${JSON.stringify(spec)} 出现在第 ${anywhere + 1} 行，但它的前序事件已推进到第 ${cursor + 1} 行之后 —— 相对顺序反了`);
  }
  return ok(TRUE, 'ok',
    `${expect.length} 个事件按相对顺序命中（流水共 ${rows.length} 行）`);
}

export const PRECEDENCE_VERSION = 'agent-web/precedence-1';

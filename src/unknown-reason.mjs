/**
 * 「判不了」的理由码该用哪一个 —— 只有一份规则。
 *
 * 断言层比判决层更清楚「为什么不知道」：后端不记录这类事件，和观测是空的，
 * 是两件不同的事，前者要改适配器，后者要补观测。混成一个代码就没人能据此行动。
 *
 * 但「把哪个码提上来」这件事必须只有一处实现。它曾经有两处：
 * runner 走白名单（所有判不了的断言同码、且该码在白名单里才提，否则退回
 * missing_observation），certify 的快路径自己写了「取第一个 unknown 的 code」。
 * 两条规则在现有变异体下恰好结论相同，所以没有任何测试会红 —— 而它们
 * 在「两条断言各自因为不同原因判不了」时给出不同答案：白名单那条会被提上来，
 * 尽管「全都因为同一个原因」这个前提已经不成立。
 *
 * 白名单是封闭的：新增一个可提升的码，等于承认它能单独解释一次判决，
 * 这是规范变更，必须同时补一条测试说明为什么它配得上。
 */

export const SPECIFIC_UNKNOWN_CODES = Object.freeze(['unsupported_event']);

const WHITELIST = new Set(SPECIFIC_UNKNOWN_CODES);

export const DEFAULT_UNKNOWN_REASON = 'missing_observation';

/**
 * @param {Array<string|undefined|null>} codes 所有判不了的断言给出的原因码（可重复）
 * @returns {string} 提到 verdict 上的理由码
 */
export function resolveUnknownReason(codes) {
  const distinct = [...new Set((codes ?? []).filter(Boolean))];
  if (distinct.length === 1 && WHITELIST.has(distinct[0])) return distinct[0];
  return DEFAULT_UNKNOWN_REASON;
}

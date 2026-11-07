/**
 * 一步的结局分类。
 *
 * 为什么单独抽出来：这段逻辑在 `runner.mjs`（判决）和 `draft.mjs`（录制回放）里
 * 各有一份，v0.60.0 只修了 runner 那份，draft 那份带着同一个洞活了一个版本。
 * 「同一类问题，第二个地方」是最常见的回归形态 —— 修的时候只修了看见的那一处。
 *
 * 所以判定语义只能有一份实现。两处调用，行为由这里决定。
 *
 * 返回值：命中则给 `{ status, code, detail }`，四类分支都不命中给 `null`。
 * `status` 是判决层用的（unknown / fail），`code` 是理由码；
 * 录制回放只关心 `code`，忽略 `status`。
 */

import { OUTCOMES, UNCERTAIN_OUTCOMES } from './adapter/contract.mjs';

/**
 * @param {object} p
 * @param {{outcome?: string, error?: {code?: string, message?: string}}} p.res 适配器的返回值
 * @param {{id?: string, capability?: string, expected_outcome?: string}} p.step 案例里的这一步
 * @param {number} p.index 步号（写进 detail，便于定位）
 * @param {string} [p.verb] 语气：「执行」用于判决，「录」用于回放。默认「执行」
 */
export function classifyStepOutcome({ res, step, index, verb = '执行' }) {
  const cap = step?.capability ?? '<unknown>';
  const outcome = res && res.outcome;

  // 契约外的值必须先拦下。四个分支全不命中时，这一步既不失败也不算未知，
  // 会一路滑到终态断言 —— 而终态断言可能正好成立，判决就 pass 了。
  // 这不是适配器写错，这是**判定权威被悄悄换掉**。
  if (!OUTCOMES.includes(outcome)) {
    return {
      status: 'unknown',
      code: 'contract_violation',
      at: index,
      detail: `适配器返回了契约外的 outcome ${JSON.stringify(outcome)}，`
        + `只认 ${OUTCOMES.join(' / ')}。这一步到底做成了没有，无法判断`,
    };
  }

  if (outcome === 'unsupported') {
    return { status: 'unknown', code: 'coverage_gap', at: index, detail: `适配器演不了 ${cap}` };
  }

  if (outcome === 'infra_error') {
    return {
      status: 'unknown',
      code: 'infrastructure_error',
      at: index,
      detail: res.error?.message ?? '适配器故障',
    };
  }

  // 「可能已经生效」与「没发生」是两条相反的重放指令，必须分开报。
  // 判 unknown 是一样的（看不见结果），但理由码不同：
  // infrastructure_error 说「可以重试」，effect_uncertain 说「不许重试，先去看状态」。
  if (UNCERTAIN_OUTCOMES.includes(outcome)) {
    return {
      status: 'unknown',
      code: 'effect_uncertain',
      at: index,
      detail: `${cap} 可能已经生效但结果没回来`
        + `（${[res.error?.code, res.error?.message].filter(Boolean).join(' ') || '适配器未给原因'}）`
        + `：这一步不许重放，先观测再决定；后续步骤不再${verb}`,
    };
  }

  if ((step?.expected_outcome ?? 'applied') === 'applied' && outcome === 'rejected') {
    return {
      status: 'fail',
      code: 'unexpected_rejection',
      at: index,
      detail: `${cap} 被拒绝：${res.error?.code} ${res.error?.message}`,
    };
  }

  if (step?.expected_outcome === 'rejected' && outcome === 'applied') {
    return {
      status: 'fail',
      code: 'expected_rejection',
      at: index,
      detail: `${cap} 应被拒绝，实际被执行`,
    };
  }

  return null;
}

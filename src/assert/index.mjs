/**
 * 断言分派与格式校验。
 *
 * 这里有一条硬规则（格式宪法）：断言必须能被机器求值。
 * 没有 llm_judge，没有"看情况"，没有自定义脚本。
 * 一条断言判不了，它返回 unknown 并说明为什么判不了，而不是让人来打分。
 *
 * 第二条硬规则：phase。
 * 同一个 kind 在不同时机求值会得到完全不同的答案：
 *   status_transition 当终态断言求值，等于只看终点不看路径 —— 中间跳态也判过。
 * 所以 kind 与 phase 必须交叉校验，默认值由 kind 推断，显式写出时要兼容。
 */

import { TRUE, FALSE, UNKNOWN, and, assertValue } from '../three-valued.mjs';
import { validateSelector } from '../select.mjs';
import * as K from './kinds.mjs';

export const KINDS = Object.freeze([
  'entity_exists',
  'field_equals',
  'count_delta',
  'status_transition',
  'unchanged',
  'event_absent',
  'composite',
]);

export const PHASES = Object.freeze(['final', 'trace', 'initial_vs_final']);

/** kind 的默认相位，以及它允许的相位集合。 */
export const PHASE_MATRIX = Object.freeze({
  entity_exists: { default: 'final', allowed: ['final'] },
  field_equals: { default: 'final', allowed: ['final'] },
  count_delta: { default: 'initial_vs_final', allowed: ['initial_vs_final'] },
  status_transition: { default: 'trace', allowed: ['trace'] },
  unchanged: { default: 'initial_vs_final', allowed: ['initial_vs_final'] },
  event_absent: { default: 'trace', allowed: ['trace'] },
  // composite 的时机由子断言决定，本身不做相位约束
  composite: { default: null, allowed: [...PHASES] },
});

const SELECTOR_KINDS = new Set(['entity_exists', 'field_equals', 'count_delta', 'status_transition']);

export function phaseOf(a) {
  if (a.phase !== undefined) return a.phase;
  const m = PHASE_MATRIX[a.kind];
  return m ? m.default : null;
}

export function validateAssertion(a, at = 'assertion') {
  const errors = [];
  if (!a || typeof a !== 'object') return [`${at} 必须是对象`];

  if (!KINDS.includes(a.kind)) {
    errors.push(`${at}.kind=${JSON.stringify(a.kind)} 不在 ${KINDS.join('/')}`);
    return errors;
  }

  const m = PHASE_MATRIX[a.kind];
  if (a.phase !== undefined) {
    if (!PHASES.includes(a.phase)) {
      errors.push(`${at}.phase=${JSON.stringify(a.phase)} 不在 ${PHASES.join('/')}`);
    } else if (!m.allowed.includes(a.phase)) {
      errors.push(
        `${at}: ${a.kind} 只能在 ${m.allowed.join('/')} 求值，声明为 ${a.phase}`,
      );
    }
  }

  if (SELECTOR_KINDS.has(a.kind)) {
    if (!a.selector) {
      errors.push(`${at}.selector 必填`);
    } else {
      errors.push(...validateSelector(a.selector, `${at}.selector`));
    }
  }

  if (a.kind === 'field_equals') {
    if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填`);
    if (!('value' in a)) errors.push(`${at}.value 必填（可以为 null）`);
  }

  if (a.kind === 'count_delta') {
    const hasDelta = a.delta !== undefined;
    const hasRange = a.min !== undefined || a.max !== undefined;
    if (!hasDelta && !hasRange) errors.push(`${at} 需要 delta 或 min/max`);
  }

  if (a.kind === 'status_transition') {
    if (!Array.isArray(a.transitions) && !Array.isArray(a.sequence)) {
      errors.push(`${at} 需要 transitions 或 sequence`);
    }
    if (Array.isArray(a.transitions)) {
      a.transitions.forEach((t, i) => {
        if (!Array.isArray(t) || t.length !== 2) {
          errors.push(`${at}.transitions[${i}] 必须是 [from, to]`);
        }
      });
    }
  }

  if (a.kind === 'unchanged') {
    if (!Array.isArray(a.scopes) && !a.scope) errors.push(`${at} 需要 scopes`);
  }

  if (a.kind === 'composite') {
    if (!['and', 'or', 'not'].includes(a.op)) errors.push(`${at}.op 必须是 and/or/not`);
    if (!Array.isArray(a.args) || a.args.length === 0) {
      errors.push(`${at}.args 必须是非空数组`);
    } else {
      a.args.forEach((sub, i) => errors.push(...validateAssertion(sub, `${at}.args[${i}]`)));
    }
  }

  return errors;
}

export function validateAssertions(list, at = 'assertions') {
  if (!Array.isArray(list)) return [`${at} 必须是数组`];
  const errors = [];
  list.forEach((a, i) => errors.push(...validateAssertion(a, `${at}[${i}]`)));
  return errors;
}

export function evalAssertion(a, ctx, depth = 0) {
  if (depth > 16) {
    return { status: UNKNOWN, code: 'invalid_case', message: 'composite 嵌套过深' };
  }
  switch (a.kind) {
    case 'entity_exists':
      return K.entity_exists(a, ctx);
    case 'field_equals':
      return K.field_equals(a, ctx);
    case 'count_delta':
      return K.count_delta(a, ctx);
    case 'status_transition':
      return K.status_transition(a, ctx);
    case 'unchanged':
      return K.unchanged(a, ctx);
    case 'event_absent':
      return K.event_absent(a, ctx);
    case 'composite':
      return K.composite(a, ctx, (sub, c) => evalAssertion(sub, c, depth + 1));
    default:
      return { status: UNKNOWN, code: 'invalid_case', message: `未知断言 ${a.kind}` };
  }
}

/**
 * 求值一组断言，返回聚合状态与逐条结果。
 * and 语义：任一条 false 即 false；否则有 unknown 即 unknown。
 */
export function evalAssertions(list, ctx) {
  const results = list.map((a, i) => {
    const r = evalAssertion(a, ctx);
    assertValue(r.status, `assertion[${i}].status`);
    return { index: i, kind: a.kind, phase: phaseOf(a), ...r };
  });
  const status = and(...results.map((r) => r.status));
  return { status, results };
}

/** 第一条「确定」失败，用于简短解释。unknown 不算确定失败。 */
export function firstFailure(list, results) {
  const i = results.findIndex((r) => r.status === FALSE);
  if (i < 0) return null;
  return { index: i, kind: list[i].kind, ...results[i] };
}

export { TRUE, FALSE, UNKNOWN };

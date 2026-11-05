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
import { relation, RELATION_OPS } from './relation.mjs';
import { evalShape, SHAPE_KINDS, SHAPE_TYPES } from './shape.mjs';
import { window as evalWindow, everyStep as evalEveryStep, WINDOW_INNER } from './window.mjs';
import { pagination as evalPagination } from './pagination.mjs';

export const KINDS = Object.freeze([
  'entity_exists',
  'field_equals',
  'count_delta',
  'status_transition',
  'unchanged',
  'event_absent',
  'composite',
  'relation',
  ...SHAPE_KINDS,
  'window',
  'every_step',
  'pagination',
]);

export { WINDOW_INNER };

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
  // 关系式只判终态。中途的关系往往合法地不成立（新建订单还没算总额那一瞬间），
  // 按 trace 求值会把正常实现判红 —— 这是它和 status_transition 的关键差别。
  relation: { default: 'final', allowed: ['final'] },
  // 形状断言只看终态的那一批行。中途的行集合本来就是流动的，
  // 按 trace 求值会把正常实现判红。
  sorted_by: { default: 'final', allowed: ['final'] },
  unique: { default: 'final', allowed: ['final'] },
  type_of: { default: 'final', allowed: ['final'] },
  subset: { default: 'final', allowed: ['final'] },
  // 时间窗与每步求值都在 trace 上工作，但它们看的是「某一段」和「每一步」，
  // 所以相位固定 trace，不允许被显式改成 final（那等于把窗口丢掉）。
  window: { default: 'trace', allowed: ['trace'] },
  every_step: { default: 'trace', allowed: ['trace'] },
  // 分页读的是每一步的执行返回（payload），不是状态快照：视图是整份状态，
  // 一条翻过页的列表在视图里和没翻页一模一样。
  pagination: { default: 'trace', allowed: ['trace'] },
});

const SELECTOR_KINDS = new Set([
  'entity_exists', 'field_equals', 'count_delta', 'status_transition', 'relation',
  ...SHAPE_KINDS,
]);

export function phaseOf(a) {
  if (a.phase !== undefined) return a.phase;
  const m = PHASE_MATRIX[a.kind];
  return m ? m.default : null;
}

export function validateAssertion(a, at = 'assertion') {
  const errors = [];
  if (!a || typeof a !== 'object') return [`${at} 必须是对象`];

  if ((a.kind === 'window' || a.kind === 'every_step') && (!a.of || typeof a.of !== 'object')) {
    return [`${at} 的 ${a.kind} 需要一个内层断言 of`];
  }
  if (a.kind === 'window') {
    if (a.from_step !== undefined && !(Number.isInteger(a.from_step) && a.from_step >= 0)) {
      errors.push(`${at}.from_step 必须是非负整数`);
    }
    if (a.to_step !== undefined && !(Number.isInteger(a.to_step) && a.to_step >= 0)) {
      errors.push(`${at}.to_step 必须是非负整数`);
    }
    if (Number.isInteger(a.from_step) && Number.isInteger(a.to_step) && a.to_step <= a.from_step) {
      errors.push(`${at}.to_step 必须大于 from_step`);
    }
    if (a.of && typeof a.of === 'object' && !WINDOW_INNER.includes(a.of.kind)) {
      errors.push(`${at}.of 只能是 ${WINDOW_INNER.join(' / ')}（其它断言在时间窗里没有意义）`);
    }
  }
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

  if (a.kind === 'relation') {
    if (!RELATION_OPS.includes(a.op)) {
      errors.push(`${at}.op=${JSON.stringify(a.op)} 不在 ${RELATION_OPS.join('/')}`);
    } else if (a.op === 'eq') {
      if (typeof a.left !== 'string' || a.left === '') errors.push(`${at}.left 必填（字段路径）`);
      if (typeof a.right !== 'string' || a.right === '') errors.push(`${at}.right 必填（字段路径）`);
    } else if (a.op === 'sum_equals') {
      if (typeof a.items !== 'string' || a.items === '') errors.push(`${at}.items 必填（明细数组的路径）`);
      if (typeof a.of !== 'string' || a.of === '') errors.push(`${at}.of 必填（明细里要求和的那个字段）`);
      if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填（实体上用来对账的字段）`);
    } else if (a.op === 'product_equals') {
      if (typeof a.items !== 'string' || a.items === '') errors.push(`${at}.items 必填`);
      if (typeof a.left !== 'string' || a.left === '') errors.push(`${at}.left 必填`);
      if (typeof a.right !== 'string' || a.right === '') errors.push(`${at}.right 必填`);
      if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填`);
    } else if (a.op === 'sorted') {
      if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填`);
    }
  }

  if (a.kind === 'sorted_by') {
    if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填`);
    if (a.order !== undefined && !['asc', 'desc'].includes(a.order)) {
      errors.push(`${at}.order 必须是 asc/desc`);
    }
  }

  if (a.kind === 'unique') {
    if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填`);
  }

  if (a.kind === 'type_of') {
    if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填`);
    if (!SHAPE_TYPES.includes(a.type)) errors.push(`${at}.type 不在 ${SHAPE_TYPES.join('/')}`);
  }

  if (a.kind === 'subset') {
    if (typeof a.path !== 'string' || a.path === '') errors.push(`${at}.path 必填`);
    if (!Array.isArray(a.values) || a.values.length === 0) errors.push(`${at}.values 必须是非空数组`);
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
    case 'relation':
      return relation(a, ctx);
    case 'sorted_by':
    case 'unique':
    case 'type_of':
    case 'subset':
      return evalShape(a, ctx);
    case 'window':
      return evalWindow(a, ctx, (sub, c) => evalAssertion(sub, c, depth + 1));
    case 'every_step':
      return evalEveryStep(a, ctx, (sub, c) => evalAssertion(sub, c, depth + 1));
    case 'pagination':
      return evalPagination(a, ctx);
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

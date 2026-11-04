/**
 * 案例格式：加载、校验、绑定解析。
 *
 * 两条校验规则值得单说：
 *
 * 1) bindings 指向一个 expected_outcome=rejected 的步骤，整条案例判 invalid。
 *    被拒绝的调用没有返回值，后面任何一步想引用它都是在引用"无"。
 *    这类错误在第一批案例上就会撞到，所以放在格式层拦掉，不留给实现者各自发挥。
 *
 * 2) 断言在加载时就校验 kind×phase，而不是等到求值。
 *    格式错误的案例应该是"根本进不来"，而不是"进来了再判 unknown"。
 */

import { validateAssertions, PHASE_MATRIX } from './assert/index.mjs';
import { getPath } from './values.mjs';

export const SCHEMA_VERSION = 'agent-web/0.1';

export const STEP_OUTCOMES = Object.freeze(['applied', 'rejected']);

export class BindingError extends Error {}

function validateStep(step, i, seen) {
  const at = `reference_trajectory[${i}]`;
  const errors = [];
  if (typeof step.id !== 'string' || step.id === '') {
    errors.push(`${at}.id 必填`);
  } else if (seen.has(step.id)) {
    errors.push(`${at}.id=${step.id} 重复`);
  }
  if (typeof step.capability !== 'string' || step.capability === '') {
    errors.push(`${at}.capability 必填`);
  }
  if (!STEP_OUTCOMES.includes(step.expected_outcome)) {
    errors.push(`${at}.expected_outcome 必须是 ${STEP_OUTCOMES.join('/')}`);
  }
  if (step.bindings !== undefined && typeof step.bindings !== 'object') {
    errors.push(`${at}.bindings 必须是对象`);
  }
  return errors;
}

/** 解析 "$s1.orderId" 形式的绑定。 */
function parseRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('$')) return null;
  const body = ref.slice(1);
  const dot = body.indexOf('.');
  if (dot < 0) return { stepId: body, path: '' };
  return { stepId: body.slice(0, dot), path: body.slice(dot + 1) };
}

function collectRefs(value, out = []) {
  if (typeof value === 'string') {
    const r = parseRef(value);
    if (r) out.push(r);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => collectRefs(v, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectRefs(v, out));
  }
  return out;
}

function checkBindings(steps) {
  const errors = [];
  const byId = new Map();
  steps.forEach((step, i) => {
    const refs = [];
    for (const [name, ref] of Object.entries(step.bindings || {})) {
      const parsed = parseRef(ref);
      if (!parsed) {
        errors.push(`reference_trajectory[${i}].bindings.${name} 必须形如 "$stepId.path"`);
        continue;
      }
      refs.push({ name, ...parsed });
    }
    // arguments 里内嵌的引用同样要检查
    collectRefs(step.arguments || {}, []).forEach((r) => refs.push({ name: '(arguments)', ...r }));

    for (const r of refs) {
      const target = byId.get(r.stepId);
      if (!target) {
        errors.push(
          `reference_trajectory[${i}].bindings.${r.name} 引用了 ${r.stepId}，但它不在前面任何一步`,
        );
        continue;
      }
      if (target.expected_outcome === 'rejected') {
        errors.push(
          `reference_trajectory[${i}].bindings.${r.name} 引用了被拒绝的步骤 ${r.stepId}：` +
            '被拒绝的调用没有返回值，整条案例按 invalid_case 处理',
        );
      }
    }
    byId.set(step.id, step);
  });
  return errors;
}

// 候选轨迹也要走同一套校验：Agent 交上来的动作序列和参考轨迹在结构上是一回事。
export function validateSteps(steps, label = 'trajectory') {
  const errors = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push(label + ' 必须是非空数组');
    return errors;
  }
  const seen = new Set();
  steps.forEach((step, i) => {
    errors.push(...validateStep(step || {}, i, seen));
    if (step && step.id) seen.add(step.id);
  });
  errors.push(...checkBindings(steps));
  return errors;
}

export function validateCase(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['案例必须是对象'];
  if (c.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version 必须是 ${SCHEMA_VERSION}，收到 ${JSON.stringify(c.schema_version)}`);
  }
  if (typeof c.id !== 'string' || c.id === '') errors.push('id 必填');

  const task = c.task;
  if (!task || typeof task !== 'object') {
    errors.push('task 必填');
  } else {
    if (typeof task.natural_goal !== 'string' || task.natural_goal === '') {
      errors.push('task.natural_goal 必填');
    }
    if (!Array.isArray(task.goal_assertions) || task.goal_assertions.length === 0) {
      errors.push('task.goal_assertions 必须是非空数组');
    } else {
      errors.push(...validateAssertions(task.goal_assertions, 'task.goal_assertions'));
    }
    if (task.preconditions !== undefined) {
      errors.push(...validateAssertions(task.preconditions, 'task.preconditions'));
    }
    if (task.invariants !== undefined) {
      errors.push(...validateAssertions(task.invariants, 'task.invariants'));
    }
    if (task.allowed_capabilities !== undefined && !Array.isArray(task.allowed_capabilities)) {
      errors.push('task.allowed_capabilities 必须是数组');
    }
  }

  if (!Array.isArray(c.reference_trajectory) || c.reference_trajectory.length === 0) {
    errors.push('reference_trajectory 必须是非空数组');
  } else {
    const seen = new Set();
    c.reference_trajectory.forEach((step, i) => {
      errors.push(...validateStep(step || {}, i, seen));
      if (step && step.id) seen.add(step.id);
    });
    errors.push(...checkBindings(c.reference_trajectory));
  }

  if (c.observability !== undefined) {
    if (!Array.isArray(c.observability.declared_scopes)) {
      errors.push('observability.declared_scopes 必须是数组');
    }
  }

  return errors;
}

/** 把 arguments 与 bindings 解析成可执行的实参。 */
export function resolveArguments(step, outputs) {
  const resolveValue = (value) => {
    if (typeof value === 'string') {
      const r = parseRef(value);
      if (!r) return value;
      const out = outputs.get(r.stepId);
      if (out === undefined) throw new BindingError(`步骤 ${r.stepId} 尚无输出`);
      return r.path === '' ? out : getPath(out, r.path);
    }
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v);
      return out;
    }
    return value;
  };

  const args = {};
  for (const [k, v] of Object.entries(step.arguments || {})) args[k] = resolveValue(v);
  for (const [k, v] of Object.entries(step.bindings || {})) args[k] = resolveValue(v);
  return args;
}

/**
 * 难度用可解释的结构特征，不拼一个未经校准的分数。
 * 这些特征只用于分层采样，不用于宣称"这条任务更难"。
 */
export function deriveLabels(c, manifest) {
  const steps = c.reference_trajectory || [];
  const kinds = new Map((manifest?.capabilities || []).map((x) => [x.id, x.kind]));
  const writeCount = steps.filter((s) => kinds.get(s.capability) === 'write').length;
  const roles = new Set(steps.map((s) => s.as).filter(Boolean));

  // 依赖深度：binding 链最长长度
  const depthOf = new Map();
  for (const step of steps) {
    let d = 0;
    for (const ref of Object.values(step.bindings || {})) {
      const parsed = parseRef(ref);
      if (parsed && depthOf.has(parsed.stepId)) {
        d = Math.max(d, depthOf.get(parsed.stepId) + 1);
      }
    }
    depthOf.set(step.id, d);
  }
  const dependencyDepth = Math.max(0, ...depthOf.values());

  return {
    action_count: steps.length,
    write_count: writeCount,
    dependency_depth: dependencyDepth,
    role_switches: Math.max(0, roles.size - 1),
    has_multi_step: steps.length >= 3,
    complex: steps.length >= 3 && writeCount >= 1,
  };
}

export function phaseSummary(assertions) {
  return (assertions || []).map((a) => ({
    kind: a.kind,
    phase: a.phase ?? PHASE_MATRIX[a.kind]?.default ?? null,
  }));
}

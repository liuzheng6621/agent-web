/**
 * 实体选择器。
 *
 * 刻意不用 JSONPath：路径与查询条件混在同一个字符串里，
 * 会让"我到底在选实体还是在取字段"变成实现者的猜测。
 * 这里把两件事分开：collection + where + index 选实体，path 取字段。
 */

import { getPath, deepEqual } from './values.mjs';

export const PRED_OPS = ['eq', 'ne', 'in', 'exists', 'gt', 'lt', 'gte', 'lte', 'contains'];

function matchPred(row, pred) {
  const actual = getPath(row, pred.field);
  if ('eq' in pred) return deepEqual(actual, pred.eq);
  if ('ne' in pred) return !deepEqual(actual, pred.ne);
  if ('in' in pred) return Array.isArray(pred.in) && pred.in.some((v) => deepEqual(actual, v));
  if ('exists' in pred) return pred.exists ? actual !== undefined : actual === undefined;
  if ('gt' in pred) return typeof actual === 'number' && actual > pred.gt;
  if ('lt' in pred) return typeof actual === 'number' && actual < pred.lt;
  if ('gte' in pred) return typeof actual === 'number' && actual >= pred.gte;
  if ('lte' in pred) return typeof actual === 'number' && actual <= pred.lte;
  if ('contains' in pred) {
    if (Array.isArray(actual)) return actual.some((v) => deepEqual(v, pred.contains));
    if (typeof actual === 'string') return actual.includes(String(pred.contains));
    return false;
  }
  return false;
}

export function validateSelector(spec, where = 'selector') {
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return [`${where} 必须是对象`];
  }
  if (typeof spec.collection !== 'string' || spec.collection === '') {
    errors.push(`${where}.collection 必须是非空字符串（点号路径）`);
  }
  if (spec.where !== undefined) {
    if (!Array.isArray(spec.where)) {
      errors.push(`${where}.where 必须是谓词数组`);
    } else {
      spec.where.forEach((p, i) => {
        if (!p || typeof p.field !== 'string') {
          errors.push(`${where}.where[${i}].field 必须是字符串`);
          return;
        }
        const ops = Object.keys(p).filter((k) => k !== 'field');
        if (ops.length !== 1) {
          errors.push(`${where}.where[${i}] 必须恰好有一个操作符`);
          return;
        }
        if (!PRED_OPS.includes(ops[0])) {
          errors.push(`${where}.where[${i}] 操作符 ${ops[0]} 不在 ${PRED_OPS.join('/')}`);
        }
      });
    }
  }
  if (spec.index !== undefined && (!Number.isInteger(spec.index) || spec.index < 0)) {
    errors.push(`${where}.index 必须是非负整数`);
  }
  return errors;
}

/**
 * @returns {{status:'ok'|'missing'|'invalid', rows:any[], total:number, reason?:string}}
 */
export function selectEntities(state, spec) {
  const coll = getPath(state, spec.collection);
  if (coll === undefined) {
    return { status: 'missing', rows: [], total: 0, reason: `作用域 ${spec.collection} 未观测` };
  }
  if (!Array.isArray(coll)) {
    return { status: 'invalid', rows: [], total: 0, reason: `${spec.collection} 不是集合` };
  }
  let rows = coll;
  if (Array.isArray(spec.where) && spec.where.length > 0) {
    rows = rows.filter((r) => spec.where.every((p) => matchPred(r, p)));
  }
  const total = rows.length;
  if (spec.index !== undefined) {
    rows = total > spec.index ? [rows[spec.index]] : [];
  }
  return { status: 'ok', rows, total };
}

/** 选择器的人话描述，用于失败原因可复述。 */
export function describeSelector(spec) {
  if (!spec || typeof spec !== 'object') return '<无效选择器>';
  let s = spec.collection;
  if (Array.isArray(spec.where) && spec.where.length > 0) {
    s += spec.where
      .map((p) => {
        const op = Object.keys(p).find((k) => k !== 'field');
        const v = JSON.stringify(p[op]);
        return `[${p.field} ${op} ${v}]`;
      })
      .join('');
  }
  if (spec.index !== undefined) s += `#${spec.index}`;
  return s;
}

/**
 * 形状断言：集合本身的结构，而不是某一行某个字段的值。
 *
 * 之前七种 kind 全都在说「第几行的第几个字段等于什么」。真正难表达的是这几句：
 *   「这个列表是按创建时间排的」
 *   「同一批里没有重复的 id」
 *   「总额是数字，不是字符串」
 *   「状态只可能是这五个值之一」
 *
 * 这四条都是**关系**或**类型**，不是取值，所以 field_equals 表达不了。
 *
 * 宪法照旧：每加一种，必须能被 certify 杀掉至少一个变异体。
 * scripts/kind-necessity.mjs 就是干这个的 —— 杀不掉的说明是装饰，不进。
 */

import { TRUE, FALSE, UNKNOWN } from '../three-valued.mjs';
import { selectEntities } from '../select.mjs';
import { getPath } from '../values.mjs';

export const SHAPE_KINDS = Object.freeze(['sorted_by', 'unique', 'type_of', 'subset']);

const TYPES = Object.freeze(['number', 'integer', 'string', 'boolean', 'array', 'object', 'null']);

function actualType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeMatches(want, v) {
  const got = actualType(v);
  if (want === 'number') return got === 'number' || got === 'integer';
  return got === want;
}

/** 选行；行数不够时返回 unknown 而不是 false —— 空集合上的结构断言没有意义。 */
function rowsOf(a, ctx) {
  const r = selectEntities(ctx.final, a.selector);
  if (r.status === 'invalid') {
    return { err: { status: UNKNOWN, code: 'invalid_case', message: r.reason } };
  }
  if (r.status === 'missing') {
    return { err: { status: UNKNOWN, code: 'missing_observation', message: r.reason } };
  }
  return { rows: r.rows };
}

export function sorted_by(a, ctx) {
  const { rows, err } = rowsOf(a, ctx);
  if (err) return err;
  if (rows.length < 2) {
    return { status: UNKNOWN, code: 'missing_observation', message: `只选出 ${rows.length} 行，排不排序都一样` };
  }
  const desc = a.order === 'desc';
  const vals = [];
  for (let i = 0; i < rows.length; i += 1) {
    const v = getPath(rows[i], a.path);
    if (v === undefined) {
      return { status: UNKNOWN, code: 'missing_observation', message: `第 ${i} 行没有 ${a.path}` };
    }
    vals.push(v);
  }
  for (let i = 1; i < vals.length; i += 1) {
    const prev = vals[i - 1];
    const cur = vals[i];
    const bad = desc ? prev < cur : prev > cur;
    if (bad) {
      return {
        status: FALSE,
        code: 'shape_violated',
        message: `没有按 ${a.path} ${desc ? '降序' : '升序'}：第 ${i - 1} 行 ${JSON.stringify(prev)}，第 ${i} 行 ${JSON.stringify(cur)}`,
      };
    }
  }
  return { status: TRUE, code: 'ok', message: `${rows.length} 行按 ${a.path} ${desc ? '降序' : '升序'}` };
}

export function unique(a, ctx) {
  const { rows, err } = rowsOf(a, ctx);
  if (err) return err;
  const seen = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const v = getPath(rows[i], a.path);
    if (v === undefined) {
      return { status: UNKNOWN, code: 'missing_observation', message: `第 ${i} 行没有 ${a.path}` };
    }
    const k = typeof v + ':' + String(v);
    if (seen.has(k)) {
      return {
        status: FALSE,
        code: 'shape_violated',
        message: `${a.path} 重复：第 ${seen.get(k)} 行与第 ${i} 行都是 ${JSON.stringify(v)}`,
      };
    }
    seen.set(k, i);
  }
  if (rows.length === 0) {
    return { status: UNKNOWN, code: 'missing_observation', message: '没选出行，唯一性无从谈起' };
  }
  return { status: TRUE, code: 'ok', message: `${rows.length} 行 ${a.path} 互不重复` };
}

export function type_of(a, ctx) {
  const { rows, err } = rowsOf(a, ctx);
  if (err) return err;
  if (rows.length === 0) {
    return { status: UNKNOWN, code: 'missing_observation', message: '没选出行，类型无从谈起' };
  }
  if (!TYPES.includes(a.type)) {
    return { status: UNKNOWN, code: 'invalid_case', message: `type=${JSON.stringify(a.type)} 不在 ${TYPES.join('/')}` };
  }
  for (let i = 0; i < rows.length; i += 1) {
    const v = getPath(rows[i], a.path);
    if (v === undefined) {
      return { status: UNKNOWN, code: 'missing_observation', message: `第 ${i} 行没有 ${a.path}` };
    }
    // null 一律放过：字段缺失和字段是 null 在跨实现时无法区分，判假会制造假红。
    if (v === null) continue;
    if (!typeMatches(a.type, v)) {
      return {
        status: FALSE,
        code: 'shape_violated',
        message: `第 ${i} 行 ${a.path} 应是 ${a.type}，实际是 ${actualType(v)}（${JSON.stringify(v)}）`,
      };
    }
  }
  return { status: TRUE, code: 'ok', message: `${rows.length} 行 ${a.path} 都是 ${a.type}` };
}

export function subset(a, ctx) {
  const { rows, err } = rowsOf(a, ctx);
  if (err) return err;
  if (!Array.isArray(a.values) || a.values.length === 0) {
    return { status: UNKNOWN, code: 'invalid_case', message: 'values 必须是非空数组' };
  }
  const allowed = new Set(a.values.map((x) => typeof x + ':' + String(x)));
  for (let i = 0; i < rows.length; i += 1) {
    const v = getPath(rows[i], a.path);
    if (v === undefined) {
      return { status: UNKNOWN, code: 'missing_observation', message: `第 ${i} 行没有 ${a.path}` };
    }
    if (v === null) continue;
    if (!allowed.has(typeof v + ':' + String(v))) {
      return {
        status: FALSE,
        code: 'shape_violated',
        message: `第 ${i} 行 ${a.path}=${JSON.stringify(v)} 不在允许集合 ${JSON.stringify(a.values)} 里`,
      };
    }
  }
  return { status: TRUE, code: 'ok', message: `${rows.length} 行 ${a.path} 都在允许集合里` };
}

export function evalShape(a, ctx) {
  switch (a.kind) {
    case 'sorted_by': return sorted_by(a, ctx);
    case 'unique': return unique(a, ctx);
    case 'type_of': return type_of(a, ctx);
    case 'subset': return subset(a, ctx);
    default: return { status: UNKNOWN, code: 'invalid_case', message: `未知形状断言 ${a.kind}` };
  }
}

export const SHAPE_TYPES = TYPES;

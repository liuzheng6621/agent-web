// 响应体层面的断言。
//
// 为什么要把这一种单独拿出来：其余 15 种断言读的都是**规范视图**（那份「此刻系统里
// 有什么」的快照），而现成的接口测试套件（hurl / Bruno / Postman）断言的几乎全是
// **响应体**本身 —— `$.user.token isString`、`$.tags count >= 1`、`$.articles[0].slug == "x"`。
// 视图里既没有 token 也没有分页信封，所以这些断句以前只能丢。
//
// 数据通路其实早就在了：`pagination` 读的就是 `ctx.trace[i].payload`。这一种只是把它
// 变成一条通用断言。

import { TRUE, FALSE, UNKNOWN } from '../three-valued.mjs';

export const PAYLOAD_OPS = Object.freeze([
  'exists',
  'equals',
  'is_string',
  'is_list',
  'not_empty',
  'count_gte',
  'count_equals',
  'contains',
]);

const NOT_FOUND = Symbol('not-found');

function tokensOf(pathText) {
  const s = String(pathText || '').trim();
  if (!s.startsWith('$')) return null;
  const out = [];
  let i = 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.') {
      i += 1;
      const start = i;
      while (i < s.length && s[i] !== '.' && s[i] !== '[') i += 1;
      if (i === start) return null;
      out.push(s.slice(start, i));
    } else if (ch === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) return null;
      const inner = s.slice(i + 1, end).trim();
      if (!/^\d+$/.test(inner)) return null;
      out.push(Number(inner));
      i = end + 1;
    } else {
      return null;
    }
  }
  return out;
}

/** 按简化 JSONPath（`$.a.b[0].c`）取值；取不到返回 undefined。 */
export function jsonPath(pathText, payload) {
  const tokens = tokensOf(pathText);
  if (!tokens) return undefined;
  let cur = payload;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof t === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[t];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      if (!Object.prototype.hasOwnProperty.call(cur, t)) return undefined;
      cur = cur[t];
    }
  }
  return cur;
}

function sizeOf(v) {
  if (typeof v === 'string' || Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return NOT_FOUND;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 响应体断言。
 * `a = {kind:'payload', step, path, op, value?}`
 */
export function payload(a, ctx) {
  const step = Number(a.step);
  const trace = ctx?.trace || [];
  if (!Number.isInteger(step) || step < 1 || step > trace.length) {
    return { status: UNKNOWN, code: 'missing_observation', message: `看不到第 ${a.step} 步的返回体（共 ${trace.length} 步）` };
  }
  const recorded = trace[step - 1];
  if (!recorded || recorded.payload === undefined) {
    return {
      status: UNKNOWN,
      code: 'missing_observation',
      message: `第 ${step} 步没有记下返回体（适配器 execute 需要回 payload）`,
    };
  }
  const value = jsonPath(a.path, recorded.payload);
  const label = `第 ${step} 步 ${a.path || ''}`.trim();

  switch (a.op) {
    case 'exists':
      return value === undefined
        ? { status: FALSE, code: 'payload_mismatch', message: `${label} 不存在` }
        : { status: TRUE, code: 'ok', message: `${label} 存在` };
    case 'equals': {
      // value_from：期望值不在案例里写死，而是「前面某一步返回体里的某个位置」。
      // 现成套件里这种写法很常见（先建一条、再翻页找它），不猜就等于丢掉一半断言。
      let expected = a.value;
      if (a.value_from !== undefined) {
        const ref = String(a.value_from);
        const m = ref.match(/^\$(s\d+)\.(.+)$/);
        if (!m) return { status: UNKNOWN, code: 'invalid_case', message: `${label} 的 value_from 读不懂：${ref}` };
        const idx = Number(m[1].slice(1)) - 1;
        const host = trace[idx];
        if (!host || host.payload === undefined) {
          return { status: UNKNOWN, code: 'missing_observation', message: `${label} 依赖第 ${idx + 1} 步的返回体，但没记下来` };
        }
        expected = jsonPath('$.' + m[2], host.payload);
        if (expected === undefined) {
          return { status: UNKNOWN, code: 'missing_observation', message: `${label} 依赖的位置 ${m[2]} 在第 ${idx + 1} 步返回体里不存在` };
        }
      }
      return deepEqual(value, expected)
        ? { status: TRUE, code: 'ok', message: `${label} == ${JSON.stringify(expected)}` }
        : { status: FALSE, code: 'payload_mismatch', message: `${label} 实际 ${JSON.stringify(value)}，期望 ${JSON.stringify(expected)}` };
    }
    case 'is_string':
      return typeof value === 'string'
        ? { status: TRUE, code: 'ok', message: `${label} 是字符串` }
        : { status: FALSE, code: 'payload_mismatch', message: `${label} 不是字符串（实际 ${typeof value}）` };
    case 'is_list':
      return Array.isArray(value)
        ? { status: TRUE, code: 'ok', message: `${label} 是数组` }
        : { status: FALSE, code: 'payload_mismatch', message: `${label} 不是数组（实际 ${typeof value}）` };
    case 'not_empty': {
      const n = sizeOf(value);
      if (n === NOT_FOUND) return { status: FALSE, code: 'payload_mismatch', message: `${label} 不是字符串/数组/对象` };
      return n > 0
        ? { status: TRUE, code: 'ok', message: `${label} 非空（${n}）` }
        : { status: FALSE, code: 'payload_mismatch', message: `${label} 是空的` };
    }
    case 'count_gte': {
      const n = sizeOf(value);
      if (n === NOT_FOUND) return { status: FALSE, code: 'payload_mismatch', message: `${label} 没有长度` };
      return n >= Number(a.value)
        ? { status: TRUE, code: 'ok', message: `${label} 长度 ${n} >= ${a.value}` }
        : { status: FALSE, code: 'payload_mismatch', message: `${label} 长度 ${n}，期望 >= ${a.value}` };
    }
    case 'count_equals': {
      const n = sizeOf(value);
      if (n === NOT_FOUND) return { status: FALSE, code: 'payload_mismatch', message: `${label} 没有长度` };
      return n === Number(a.value)
        ? { status: TRUE, code: 'ok', message: `${label} 长度 ${n} == ${a.value}` }
        : { status: FALSE, code: 'payload_mismatch', message: `${label} 长度 ${n}，期望 ${a.value}` };
    }
    case 'contains': {
      if (Array.isArray(value)) {
        return value.some((x) => deepEqual(x, a.value))
          ? { status: TRUE, code: 'ok', message: `${label} 含 ${JSON.stringify(a.value)}` }
          : { status: FALSE, code: 'payload_mismatch', message: `${label} 不含 ${JSON.stringify(a.value)}` };
      }
      if (typeof value === 'string') {
        return value.includes(String(a.value))
          ? { status: TRUE, code: 'ok', message: `${label} 含 ${JSON.stringify(a.value)}` }
          : { status: FALSE, code: 'payload_mismatch', message: `${label} 不含 ${JSON.stringify(a.value)}` };
      }
      return { status: FALSE, code: 'payload_mismatch', message: `${label} 不是数组也不是字符串` };
    }
    default:
      return { status: UNKNOWN, code: 'invalid_case', message: `payload 不认识 op=${a.op}` };
  }
}

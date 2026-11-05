/**
 * pagination：跨页检查。
 *
 * 为什么需要它：分页的四种坏法全都藏在「页与页之间」——
 * 跨页重复、边界丢行、翻页乱序、total 说谎。单看任何一页都是好的，
 * 逐页的 count_delta 也都是对的（每页确实拿到了 pageSize 条）。
 *
 * 数据来源是 trace 里记下的执行返回（payload），不是规范视图：
 * 视图是整份状态快照，一条翻页过的列表在视图里和没翻过一模一样。
 */
import { FALSE, TRUE, UNKNOWN } from '../three-valued.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 从返回体里取出这一页的行。collection 省略时要求返回体本身是数组。
 * 兼容 {orders:[...]} 与 {data:{orders:[...]}} 两种常见包裹。
 */
export function rowsOfPayload(payload, collection) {
  if (Array.isArray(payload)) {
    return collection ? null : payload;
  }
  if (!isObj(payload)) return null;
  if (collection) {
    if (Array.isArray(payload[collection])) return payload[collection];
    if (isObj(payload.data) && Array.isArray(payload.data[collection])) return payload.data[collection];
    return null;
  }
  for (const key of ['items', 'data', 'results', 'list']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return null;
}

const label = (a) => a.collection ?? 'items';

/**
 * @param a { steps:number[], collection?:string, total?:number, pageSize?:number, ordered_by?:string, id_field?:string }
 *   steps 是 1 基步号，与 window 的 from_step/to_step 同一套坐标。
 */
export function pagination(a, ctx) {
  const steps = Array.isArray(a.steps) ? a.steps : null;
  if (!steps || steps.length < 2) {
    return { status: UNKNOWN, code: 'invalid_case', message: 'pagination 至少要列两页（steps 至少两个步号）' };
  }
  if (a.total !== undefined && !(Number.isInteger(a.total) && a.total >= 0)) {
    return { status: UNKNOWN, code: 'invalid_case', message: 'total 必须是非负整数' };
  }
  if (a.pageSize !== undefined && !(Number.isInteger(a.pageSize) && a.pageSize > 0)) {
    return { status: UNKNOWN, code: 'invalid_case', message: 'pageSize 必须是正整数' };
  }

  const pages = [];
  for (const n of steps) {
    if (!Number.isInteger(n) || n < 1) {
      return { status: UNKNOWN, code: 'invalid_case', message: `步号必须是正整数，收到 ${JSON.stringify(n)}` };
    }
    const t = ctx.trace?.[n - 1];
    if (!t) {
      return {
        status: UNKNOWN,
        code: 'missing_observation',
        message: `轨迹里没有第 ${n} 步，无法检查分页`,
      };
    }
    const rows = rowsOfPayload(t.payload, a.collection);
    if (!rows) {
      return {
        status: UNKNOWN,
        code: 'missing_observation',
        message: `第 ${n} 步的返回里没有 ${a.collection ?? '数组'}，分页无从检查（适配器把结果放在别处，或这一步不是列表）`,
      };
    }
    pages.push({ step: n, rows });
  }

  // 1) 跨页重复：同一行出现在两页里
  if (a.id_field || a.ordered_by) {
    const field = a.id_field ?? a.ordered_by;
    const seen = new Map();
    for (const p of pages) {
      for (const row of p.rows) {
        const key = row?.[field];
        if (key === undefined || key === null) continue;
        const at = seen.get(key);
        if (at !== undefined) {
          const where = at === p.step
            ? `第 ${p.step} 步的返回里出现了两次`
            : `同时出现在第 ${at} 步和第 ${p.step} 步的返回里`;
          return {
            status: FALSE,
            code: 'pagination_duplicate',
            message: `重复行：${label(a)} 的 ${field}=${JSON.stringify(key)} ${where}`,
          };
        }
        seen.set(key, p.step);
      }
    }
  }

  // 2) 页大小：除最后一页外每页都必须是满的
  if (a.pageSize !== undefined) {
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const isLast = i === pages.length - 1;
      if (!isLast && p.rows.length !== a.pageSize) {
        return {
          status: FALSE,
          code: 'pagination_size',
          message: `第 ${p.step} 步不是最后一页，却只有 ${p.rows.length} 条（每页 ${a.pageSize}）——边界丢行或提前结束`,
        };
      }
      if (p.rows.length > a.pageSize) {
        return {
          status: FALSE,
          code: 'pagination_size',
          message: `第 ${p.step} 步返回 ${p.rows.length} 条，超过每页 ${a.pageSize}`,
        };
      }
    }
  }

  // 3) 覆盖：几页加起来必须正好是 total
  if (a.total !== undefined) {
    const got = pages.reduce((n, p) => n + p.rows.length, 0);
    if (got !== a.total) {
      return {
        status: FALSE,
        code: 'pagination_total',
        message: `翻完 ${pages.length} 页只拿到 ${got} 条，声称总共 ${a.total} 条——丢行，或 total 在说谎`,
      };
    }
  }

  // 4) 顺序：按页次拼接后，排序字段必须单调不减
  if (a.ordered_by) {
    const flat = pages.flatMap((p) => p.rows);
    for (let i = 1; i < flat.length; i++) {
      const prev = flat[i - 1]?.[a.ordered_by];
      const cur = flat[i]?.[a.ordered_by];
      if (prev === undefined || cur === undefined) {
        return {
          status: UNKNOWN,
          code: 'missing_observation',
          message: `行里没有 ${a.ordered_by}，无法检查跨页顺序`,
        };
      }
      if (typeof prev === 'number' && typeof cur === 'number') {
        if (cur < prev) {
          return {
            status: FALSE,
            code: 'pagination_order',
            message: `翻页乱序：按页次拼接后 ${a.ordered_by} 从 ${prev} 掉到 ${cur}（第 ${i} 条）`,
          };
        }
      } else if (String(cur) < String(prev)) {
        return {
          status: FALSE,
          code: 'pagination_order',
          message: `翻页乱序：按页次拼接后 ${a.ordered_by} 从 ${JSON.stringify(prev)} 掉到 ${JSON.stringify(cur)}`,
        };
      }
    }
  }

  const flat = pages.flatMap((p) => p.rows);
  return {
    status: TRUE,
    code: 'ok',
    message: `翻 ${pages.length} 页共 ${flat.length} 条，无重复、无丢行、顺序单调`,
  };
}

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
 * 实现自己在返回体里报的 total。
 *
 * 分页的第四种坏法是「total 说谎」：命中 30 条却报 900，前端据此算出 90 页，
 * 用户翻到第 4 页就是空的。这种坏法在**每一页的返回体**里都看得见，
 * 而把各页条数加起来永远等于 30 —— 所以必须单独读这个字段，不能只数行。
 * 兼容 {total} 与 {data:{total}} 两种常见包裹；没有这个字段就跳过（不是所有实现都报）。
 */
function reportedTotalOf(payload, collection) {
  const pick = (o) => (o && typeof o === 'object' && typeof o.total === 'number' ? o.total : undefined);
  const direct = pick(payload);
  if (direct !== undefined) return direct;
  if (payload && typeof payload === 'object') return pick(payload.data);
  return undefined;
}

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
    pages.push({ step: n, rows, reportedTotal: reportedTotalOf(t.payload, a.collection) });
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

  // 3) 实现自己报的 total 必须与案例声称的一致。
  //    放在「数行数」之前：行数对、报数错，是最常见的一种假绿 ——
  //    每页都满、拼起来也正好 30 条，只有 total 写着 900。
  if (a.total !== undefined) {
    for (const p of pages) {
      if (p.reportedTotal !== undefined && p.reportedTotal !== a.total) {
        return {
          status: FALSE,
          code: 'pagination_total_reported',
          message: `第 ${p.step} 步返回的 total 是 ${p.reportedTotal}，案例声称 ${a.total} —— 报的命中数与实际不符`,
        };
      }
    }
  }

  // 3b) 覆盖：几页加起来必须正好是 total
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

  // 4) 顺序：按页次拼接后必须**始终朝同一个方向**单调。
  //    不要求升序也不要求降序 —— 升序还是降序是各实现自己的约定（内存适配器升序、
  //    真实后端按 id 倒序），案例不该把它写死。真正的不变量是「页与页之间方向不翻」：
  //    第一页降序、第二页升序，就是翻页丢 ORDER BY 的典型症状。
  if (a.ordered_by) {
    const flat = pages.flatMap((p) => p.rows);
    let dir = 0; // 1 升、-1 降、0 还没定
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
      const cmp = typeof prev === 'number' && typeof cur === 'number'
        ? (cur > prev ? 1 : cur < prev ? -1 : 0)
        : (String(cur) > String(prev) ? 1 : String(cur) < String(prev) ? -1 : 0);
      if (cmp === 0) continue;
      if (dir === 0) { dir = cmp; continue; }
      if (cmp !== dir) {
        return {
          status: FALSE,
          code: 'pagination_order',
          message: `翻页乱序：按页次拼接后 ${a.ordered_by} 从 ${JSON.stringify(prev)} 到 ${JSON.stringify(cur)}，方向与前面相反（前面是${dir > 0 ? '升序' : '降序'}）`,
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

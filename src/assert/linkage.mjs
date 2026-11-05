// linkage：跨实体的存在性约束。
//
// 现在 16 种断言都能看「某个集合里某一行长什么样」，但说不出
// 「凡是 A 里的行，B 里都必须有一条对应的」——这类约束在真实系统里到处都是：
// 审批通过了，动物状态必须跟着变；订单建了，流水里必须有那条事件。
// 缺了它，这类故障只能靠人眼，或者靠一条绑死具体数字的 count_delta 冒充。

const OPS = new Set(['equals', 'not_equals', 'exists']);
// 数量关系：一行 A 对应的 B 行**有几条**。
// 存在性说得清「有没有」，说不清「多了几条」——重复写事件这类故障就藏在中间。
const COUNT_OPS = new Set(['equals', 'at_least', 'at_most']);

function whereMatch(row, where) {
  if (!Array.isArray(where)) return true;
  return where.every((c) => {
    const v = row ? row[c.field] : undefined;
    if (c.op === 'not_equals') return v !== c.value;
    return v === c.value;
  });
}

const get = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function linkage(a, ctx) {
  const state = ctx.final;
  const fromCol = a && a.from && a.from.collection;
  const toCol = a && a.to && a.to.collection;
  const on = (a && a.to && a.to.on) || {};
  const expect = (a && a.expect) || {};

  const rowsFrom = state ? state[fromCol] : undefined;
  const rowsTo = state ? state[toCol] : undefined;
  if (!Array.isArray(rowsFrom) || !Array.isArray(rowsTo)) {
    // 集合本身看不见，不等于约束被违反。
    return { status: 'unknown', code: 'missing_observation', message: `看不到 ${fromCol} 或 ${toCol} 这两个集合` };
  }
  if (!on.from_field || !on.to_field) {
    return { status: 'unknown', code: 'invalid_case', message: 'linkage 必须给 to.on.from_field 与 to.on.to_field' };
  }

  const checked = [];
  for (let i = 0; i < rowsFrom.length; i += 1) {
    const row = rowsFrom[i];
    if (!whereMatch(row, a.from.where)) continue;
    const key = get(row, on.from_field);
    const matches = rowsTo.filter((r) => get(r, on.to_field) === key);
    const hit = matches[0];
    checked.push({ row, key, hit });
    if (!hit) {
      // 「A 有、B 没有」是**违反**，不是看不见：两个集合都读到了，
      // 只是那一条对应关系不存在。把它记成 unknown 会让这个断言永远抓不到故障。
      return {
        status: 'false',
        code: 'linkage_missing',
        message: `${fromCol}[${i}] 的 ${on.from_field}=${key} 在 ${toCol} 里找不到对应的 ${on.to_field}`,
      };
    }
    // 数一遍：给出 expect.count 时只查条数，不再看字段
    if (expect.count !== undefined) {
      const want = Number(expect.count);
      const op = expect.count_op || 'equals';
      if (!COUNT_OPS.has(op)) {
        return { status: 'unknown', code: 'invalid_case', message: `linkage 不认识 expect.count_op=${op}` };
      }
      const n = matches.length;
      const ok = op === 'equals' ? n === want : (op === 'at_least' ? n >= want : n <= want);
      if (!ok) {
        const word = op === 'equals' ? '必须正好' : (op === 'at_least' ? '至少' : '至多');
        return {
          status: 'false',
          code: 'linkage_count_violated',
          message: `${fromCol}[${i}]（${on.from_field}=${key}）对应的 ${toCol} 有 ${n} 条，${word} ${want} 条`,
        };
      }
      continue;
    }
    const actual = expect.field ? get(hit, expect.field) : hit;
    if (!OPS.has(expect.op || 'equals')) {
      return { status: 'unknown', code: 'invalid_case', message: `linkage 不认识 expect.op=${expect.op}` };
    }
    const want = expect.value;
    if ((expect.op || 'equals') === 'exists') continue;
    const ok = (expect.op === 'not_equals') ? actual !== want : actual === want;
    if (!ok) {
      return {
        status: 'false',
        code: 'linkage_violated',
        message: `${fromCol}[${i}]（${on.from_field}=${key}）对应的 ${toCol} 那条，${expect.field} 是 ${JSON.stringify(actual)}，期望 ${expect.op === 'not_equals' ? '不等于' : ''}${JSON.stringify(want)}`,
      };
    }
  }
  if (checked.length === 0) {
    return { status: 'unknown', code: 'missing_observation', message: `没有一行 ${fromCol} 满足 from.where，这条约束什么也没检查到` };
  }
  return { status: 'true', code: 'ok', message: `${checked.length} 行 ${fromCol} 都在 ${toCol} 里对上了` };
}

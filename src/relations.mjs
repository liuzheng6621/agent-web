/**
 * 从观测里发现「字段之间的关系」，供 draft 提议成断言。
 *
 * 纪律只有一条：**先验证，再提议**。任何一条提议都必须在这条轨迹的终态上成立，
 * 否则它就是在给人挖坑 —— 人会以为草稿是「照着实际发生写的」，于是直接接受。
 *
 * 另一条：只提议**结构性**关系。Daikon 会统计「这个不变式在 N 次运行里成立」，
 * 那种东西换个输入就假；这里的模板是「在任何一次运行上都应该成立」，
 * 违反即 bug。代价是只能覆盖算术/顺序这几类，收益是提议出去不会自相矛盾。
 */

import { getPath } from './values.mjs';

const NUM = (v) => typeof v === 'number' && Number.isFinite(v);

function numericFields(obj) {
  return Object.entries(obj ?? {})
    .filter(([, v]) => NUM(v))
    .map(([k]) => k);
}

function arrayFields(obj) {
  return Object.entries(obj ?? {})
    .filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x)))
    .map(([k]) => k);
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const close = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * @returns {Array<{assertion:object, why:string, confidence:'structural'|'coincidence', sample:string}>}
 */
export function discoverRelations({ initial, final, manifest = {}, maxPerEntity = 3 }) {
  const out = [];
  if (!final || typeof final !== 'object') return out;

  const collections = Object.keys(final).filter((k) => Array.isArray(final[k]));

  for (const col of collections) {
    const rows = final[col];
    if (rows.length === 0) continue;
    const row = rows[0];
    const entitySelector = rows.length === 1 ? { collection: col, index: 0 } : { collection: col, index: 0 };
    const before = Array.isArray(getPath(initial, col)) ? getPath(initial, col) : [];

    const found = [];

    // ① 明细之和 == 实体字段
    for (const arr of arrayFields(row)) {
      const items = row[arr];
      const subNumeric = numericFields(items[0]);
      const topNumeric = numericFields(row).filter((f) => f !== arr);
      for (const of of subNumeric) {
        const vals = items.map((it) => it[of]);
        if (vals.some((v) => !NUM(v))) continue;
        const total = sum(vals);
        for (const path of topNumeric) {
          if (!close(row[path], total)) continue;
          found.push({
            assertion: { kind: 'relation', op: 'sum_equals', selector: entitySelector, items: arr, of, path },
            why: `${col} 的 ${path}（${row[path]}）等于 ${arr}[].${of} 之和（${vals.join(' + ')} = ${total}）`,
            confidence: items.length >= 2 ? 'structural' : 'coincidence',
            sample: `${path}=${row[path]} Σ${of}=${total}`,
          });
        }
      }

      // ② 明细里 a × b == c
      for (let i = 0; i < subNumeric.length; i += 1) {
        for (let j = i + 1; j < subNumeric.length; j += 1) {
          const left = subNumeric[i];
          const right = subNumeric[j];
          for (const path of subNumeric) {
            if (path === left || path === right) continue;
            const holds = items.every((it) => close(it[left] * it[right], it[path]));
            if (!holds) continue;
            found.push({
              assertion: { kind: 'relation', op: 'product_equals', selector: entitySelector, items: arr, left, right, path },
              why: `${arr}[].${path} 在每条明细上都等于 ${left} × ${right}（${items
                .map((it) => `${it[left]}×${it[right]}=${it[path]}`)
                .join('；')}）`,
              // 「1 条明细、数量 1」时这条关系几乎恒真：漏乘数量、少算一项都会碰巧成立。
              // 只有能把它和其他可能实现区分开的时候，它才算结构性关系。
              confidence:
                items.length >= 2 && items.some((it) => NUM(it[right]) && it[right] > 1)
                  ? 'structural'
                  : 'coincidence',
              sample: `${items.length} 条明细`,
            });
          }
        }
      }
    }

    // ③ 实体里两个字段恒等
    const topNumeric = numericFields(row);
    for (let i = 0; i < topNumeric.length; i += 1) {
      for (let j = i + 1; j < topNumeric.length; j += 1) {
        if (!close(row[topNumeric[i]], row[topNumeric[j]])) continue;
        found.push({
          assertion: { kind: 'relation', op: 'eq', selector: entitySelector, left: topNumeric[i], right: topNumeric[j] },
          why: `${col} 的 ${topNumeric[i]} 与 ${topNumeric[j]} 在这条轨迹上都等于 ${row[topNumeric[i]]}`,
          // 两个数字碰巧相等太常见，一律降级成巧合，让人自己判
          confidence: 'coincidence',
          sample: `${topNumeric[i]}=${topNumeric[j]}=${row[topNumeric[i]]}`,
        });
      }
    }

    // ④ 集合某字段单调不减（至少要 3 行才谈得上「单调」）
    if (rows.length >= 3) {
      for (const f of numericFields(row)) {
        const vals = rows.map((r) => getPath(r, f));
        if (vals.some((v) => !NUM(v))) continue;
        let mono = true;
        for (let i = 1; i < vals.length; i += 1) if (vals[i - 1] > vals[i]) { mono = false; break; }
        if (!mono) continue;
        if (before.length >= rows.length) continue; // 只对本次确实新增了行的集合提
        found.push({
          assertion: { kind: 'relation', op: 'sorted', selector: { collection: col }, path: f },
          why: `${col}[].${f} 在本次新增的行上单调不减（${vals.join(' <= ')}）`,
          confidence: 'structural',
          sample: `${vals.length} 行`,
        });
      }
    }

    // 结构性优先，其次巧合；同一实体最多提议 maxPerEntity 条
    found.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'structural' ? -1 : 1));
    out.push(...found.slice(0, maxPerEntity));
  }

  return out;
}

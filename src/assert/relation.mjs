/**
 * 关系型断言：一句话说不完的不变式。
 *
 * 前面七种断言只能写「这个字段等于这个值」「这个集合多了几条」。
 * 但真实系统里最值钱的判据是**字段之间的关系**：
 *
 *   totalAmount == Σ items.subTotal        （总额等于明细之和）
 *   subTotal    == unitPrice × count       （小计等于单价乘数量）
 *   pickupNo    单调不减                    （取餐号不会倒着发）
 *
 * 这四类模板来自 Daikon 的不变式目录（x==y、ret==sum(a)、a==b*c、sorted(a)），
 * 但这里不收「在某次运行里成立」这种统计式不变式 —— 那种东西换个输入就假。
 * 这里只收**结构性关系**：它在任何一次运行上都应该成立，违反就是 bug。
 *
 * 为什么要它：只在「拿铁 ×1」的单子上断言金额，等于没断言金额 ——
 * 「漏乘数量」和「正确算法」在 qty=1 时算出同一个数。关系式不吃这个亏，
 * 它在 qty=1 时同样要求 subTotal == unitPrice × count。
 */

import { TRUE, FALSE, UNKNOWN } from '../three-valued.mjs';
import { selectEntities, describeSelector } from '../select.mjs';
import { getPath } from '../values.mjs';

const ok = (status, code, message) => ({ status, code, message });

export const RELATION_OPS = Object.freeze(['eq', 'sum_equals', 'product_equals', 'sorted', 'sum_by_equals']);

const NUMERIC = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 浮点等价判据：容差随量级走（相对 1e-9，绝对下限 1e-9）。
 *
 * 为什么不能用固定绝对容差：float64 在 1e9 量级的最小间隔约 1.2e-7，
 * 固定 1e-9 会把「算得对的大额账」判成 violation —— 假红跟假绿一样毁判决：
 * 前者让人去查一笔没坏的账，查三次之后没人再信这个断言。
 * 也为什么不能用精确相等：0.1 + 0.2 与 0.3 差 5.6e-17，那是浮点的错，
 * 不是账的错。
 * 这把尺子曾经有两把（sum_equals 用 1e-9、sum_by_equals 用 ===），
 * 同一笔 0.1+0.2 的账在两个算子下一个绿一个红。现在只有这一把。
 */
function close(x, y) {
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}

function guard(spec, ctx) {
  const sel = selectEntities(ctx.final, spec);
  if (sel.status === 'missing') return { blocked: ok(UNKNOWN, 'missing_observation', sel.reason) };
  if (sel.status === 'invalid') return { blocked: ok(UNKNOWN, 'invalid_case', sel.reason) };
  if (sel.total === 0) {
    return { blocked: ok(UNKNOWN, 'missing_observation', `${describeSelector(spec)} 没有选中任何实体`) };
  }
  return { sel };
}

/** eq：实体里两个字段必须相等。 */
function opEq(a, row, spec) {
  const left = getPath(row, a.left);
  const right = getPath(row, a.right);
  if (left === undefined || right === undefined) {
    return ok(UNKNOWN, 'missing_observation', `${describeSelector(spec)} 上 ${a.left} / ${a.right} 有一个读不到`);
  }
  if (left === right) return ok(TRUE, 'ok', `${describeSelector(spec)}: ${a.left}=${fmt(left)} 与 ${a.right}=${fmt(right)} 一致`);
  return ok(FALSE, 'relation_violated', `${describeSelector(spec)}: ${a.left}=${fmt(left)}，${a.right}=${fmt(right)}，两者必须相等`);
}

/** sum_equals：明细数组某个数字字段之和，必须等于实体上的某个字段。 */
function opSumEquals(a, row, spec) {
  const items = getPath(row, a.items);
  const total = getPath(row, a.path);
  if (!Array.isArray(items)) {
    return ok(UNKNOWN, 'missing_observation', `${describeSelector(spec)} 的 ${a.items} 不是数组`);
  }
  if (!NUMERIC(total)) {
    return ok(UNKNOWN, 'missing_observation', `${describeSelector(spec)} 的 ${a.path} 不是数字：${fmt(total)}`);
  }
  const values = items.map((it) => getPath(it, a.of));
  if (values.some((v) => !NUMERIC(v))) {
    return ok(UNKNOWN, 'missing_observation', `${describeSelector(spec)} 的 ${a.items}[].${a.of} 有非数字项`);
  }
  const sum = values.reduce((x, y) => x + y, 0);
  if (close(sum, total)) {
    return ok(TRUE, 'ok', `${describeSelector(spec)}: Σ${a.of}=${fmt(sum)} 等于 ${a.path}=${fmt(total)}`);
  }
  return ok(
    FALSE,
    'relation_violated',
    `${describeSelector(spec)}: Σ${a.of}=${fmt(sum)}，但 ${a.path}=${fmt(total)}，两者必须相等` +
      `（明细 ${values.map(fmt).join(' + ')}）`,
  );
}

/** product_equals：明细里每个元素的 left × right 必须等于 path。 */
function opProductEquals(a, row, spec) {
  const items = getPath(row, a.items);
  if (!Array.isArray(items) || items.length === 0) {
    return ok(UNKNOWN, 'missing_observation', `${describeSelector(spec)} 的 ${a.items} 不是非空数组`);
  }
  for (let i = 0; i < items.length; i += 1) {
    const l = getPath(items[i], a.left);
    const r = getPath(items[i], a.right);
    const p = getPath(items[i], a.path);
    if (!NUMERIC(l) || !NUMERIC(r) || !NUMERIC(p)) {
      return ok(UNKNOWN, 'missing_observation', `${describeSelector(spec)} 的 ${a.items}[${i}] 有非数字项`);
    }
    if (!close(l * r, p)) {
      return ok(
        FALSE,
        'relation_violated',
        `${describeSelector(spec)}: ${a.items}[${i}].${a.path}=${fmt(p)}，但 ${a.left}×${a.right}=${fmt(l)}×${fmt(r)}=${fmt(l * r)}`,
      );
    }
  }
  return ok(TRUE, 'ok', `${describeSelector(spec)}: 每条明细都满足 ${a.path} == ${a.left}×${a.right}`);
}

/** sorted：集合某字段按出现顺序单调不减。 */
function opSorted(a, rows, spec) {
  const vals = rows.map((r) => getPath(r, a.path));
  if (vals.some((v) => v === undefined)) {
    return ok(UNKNOWN, 'missing_observation', `${spec.collection}[].${a.path} 有读不到的项`);
  }
  for (let i = 1; i < vals.length; i += 1) {
    const prev = vals[i - 1];
    const cur = vals[i];
    const comparable = (NUMERIC(prev) && NUMERIC(cur)) || (typeof prev === 'string' && typeof cur === 'string');
    if (!comparable) {
      return ok(UNKNOWN, 'missing_observation', `${spec.collection}[].${a.path} 类型不一致，无法比较`);
    }
    if (prev > cur) {
      return ok(
        FALSE,
        'relation_violated',
        `${describeSelector(spec)}: ${a.path} 在第 ${i} 行从 ${fmt(prev)} 掉到 ${fmt(cur)}，必须单调不减`,
      );
    }
  }
  return ok(TRUE, 'ok', `${describeSelector(spec)}: ${a.path} 单调不减（${vals.map(fmt).join(' <= ')}）`);
}

function fmt(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'undefined';
  return String(v);
}


/**
 * sum_by_equals：同一集合里，按 group_field 分成两组，两组 field 之和必须相等。
 * 借贷平衡就是这条：Σ(debit.amount) == Σ(credit.amount)。
 * 多一条贷方分录不会被「交易条数」「描述」看见，只有这个和看得见。
 */
function opSumByEquals(a, rows) {
  const { leaf, field, group_field: gf, left, right } = a;
  if (!field || !gf || !left || !right) {
    return ok(UNKNOWN, 'invalid_case', 'sum_by_equals 需要 field / group_field / left / right');
  }
  let l = 0;
  let r = 0;
  let seen = 0;
  let skipped = 0;
  for (const row of rows) {
    const items = leaf ? row[leaf] : [row];
    if (!Array.isArray(items)) { skipped += 1; continue; }
    for (const it of items) {
      const g = it && it[gf];
      const v = it && it[field];
      if (!NUMERIC(v)) { skipped += 1; continue; }
      if (g === left) { l += v; seen += 1; } else if (g === right) { r += v; seen += 1; }
    }
  }
  if (seen === 0) return ok(UNKNOWN, 'missing_observation', `没找到 ${gf}=${left}/${right} 的行`);
  const note = skipped > 0 ? `（跳过 ${skipped} 条读不懂的分录）` : '';
  if (!close(l, r)) return ok(FALSE, 'relation_violated', `${left} 合计 ${l} ≠ ${right} 合计 ${r}${note}`);
  return ok(TRUE, 'ok', `${left} 与 ${right} 各 ${l}${note}`);
}

export function relation(a, ctx) {
  const g = guard(a.selector, ctx);
  if (g.blocked) return g.blocked;

  if (a.op === 'sum_by_equals') return opSumByEquals(a, g.sel.rows);

  if (a.op === 'sorted') {
    // 集合级：一次判完整个集合，不做「每行都判一遍再取最坏」——
    // 那样报错会指向某一行的字段，而真正出问题的是行与行之间的顺序。
    return opSorted(a, g.sel.rows, a.selector);
  }

  // 实体级：对选中的每一行都求值，取最坏结果。
  let worst = null;
  for (const row of g.sel.rows) {
    let r;
    if (a.op === 'eq') r = opEq(a, row, a.selector);
    else if (a.op === 'sum_equals') r = opSumEquals(a, row, a.selector);
    else if (a.op === 'product_equals') r = opProductEquals(a, row, a.selector);
    else return ok(UNKNOWN, 'invalid_case', `未知关系 op=${JSON.stringify(a.op)}，可用：${RELATION_OPS.join('/')}`);
    if (r.status === FALSE) return r;
    if (r.status === UNKNOWN && worst === null) worst = r;
  }
  return worst ?? ok(TRUE, 'ok', `${describeSelector(a.selector)}: 关系成立`);
}

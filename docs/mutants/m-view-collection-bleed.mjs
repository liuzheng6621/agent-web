import { wrapState } from './_helpers.mjs';

/**
 * 集合渗漏：明细列表里混进了另一个集合的行。
 *
 * 症状：订单明细 items 里出现「流水」形状的行（type/from/to...），没有菜名。
 * 怎么坏：把 orders[0].items 整个替换成 status_log 的行 —— 模拟 JOIN 键错位
 *         （order_id 拼错/视图读错集合）——数据「还在」，只是张冠李戴。
 *         与 m-sql-total-drift 的分工：那是金额错，这条是**形状错**（拿错集合）。
 * 怎么抓：field_equals(orders[0].items.0.dishName, '拿铁') —— 渗漏后 dishName
 *         是 undefined → 判假；relation(product_equals) 同理（count/unitPrice
 *         变 undefined）。下钻一格的断言天生防「形状对不上」。
 */
export const meta = {
  id: 'm-view-collection-bleed',
  title: '集合渗漏：明细列表混进流水行',
  layer: 'state',
  symptom: '订单明细里出现流水形状的行，菜名消失',
  mechanism: 'orders[0].items 整体替换成 status_log 的行，模拟 JOIN 键错位或视图读错集合',
  catch_hint: 'field_equals(items.0.dishName) 判假（渗漏后为 undefined）；relation(product_equals) 同理。',
  applies_to: { capabilities: ['order.create'], collections: ['orders', 'status_log'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const order = state.orders?.[0];
    if (!order) return;
    if (!Array.isArray(state.status_log) || state.status_log.length === 0) return;
    order.items = state.status_log.map((r) => ({ ...r }));
  });
}

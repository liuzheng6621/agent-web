import { wrapState } from './_helpers.mjs';

// 单价漂移：菜单价目改了、订单明细沿用旧价，或投影读错列。
// 与 m-subtotal-stale 对称：那边 subTotal 过期，这边 unitPrice 单独漂——
// 两个数只坏一个，单看总额对不出账，必须逐项对 count×unitPrice=subTotal。
export const meta = {
  id: 'm-unit-price-flip',
  title: '单价漂移：明细单价与小计脱钩',
  layer: 'state',
  symptom: '订单明细里的单价和实际结算对不上（改价沿用旧价 / 投影读错列）',
  mechanism: '把 orders[0].items[0].unitPrice 单独 +10，subTotal 与 totalAmount 保持真实',
  catch_hint: 'product_equals(count×unitPrice=subTotal) 必翻；coffee-sql 域 price-truth 的 field_equals(unitPrice,28) 直接判假。',
  applies_to: { capabilities: ['order.create'], collections: ['orders'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const item = state.orders?.[0]?.items?.[0];
    if (item && typeof item.unitPrice === 'number') item.unitPrice = item.unitPrice + 10;
  });
}

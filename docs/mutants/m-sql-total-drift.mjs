import { wrapState } from './_helpers.mjs';

// 金额漂移：SQL 投影把 total_amount 搞错单位（分当元）或读错列。
// 单字段断言（field_equals=28）抓得住一例；relation 的明细对账
// （count×unitPrice=subTotal、ΣsubTotal=totalAmount）让它连明细一起露馅。
export const meta = {
  id: 'm-sql-total-drift',
  title: '总额漂移：SQL 投影读错金额单位',
  layer: 'state',
  symptom: '数据库直读出来的订单总额是下单页的十倍还多一点',
  mechanism: '把 orders[0].totalAmount 改成 ×10 再加 0.1（模拟分/元错位+舍入脏数据）',
  catch_hint: 'field_equals(totalAmount,28) 判假；price-truth 的 sum_equals 对账必翻。',
  applies_to: { capabilities: ['order.create'], collections: ['orders'], adapters: ['taixianglian-sql'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const o = state.orders?.[0];
    if (o && typeof o.totalAmount === 'number') o.totalAmount = o.totalAmount * 10 + 0.1;
  });
}

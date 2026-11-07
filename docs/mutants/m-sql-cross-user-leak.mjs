import { wrapState } from './_helpers.mjs';

// 身份塌缩的 SQL 版：HTTP 适配器记得 WHERE username=?，SQL 映射层忘写。
// 后果不是「看不见自己的单」，而是「看得见所有人的单」——多出来的行
// 会把 count_delta、unique、属主断言全部搅浑。真实后端上这是数据越权。
export const meta = {
  id: 'm-sql-cross-user-leak',
  title: 'SQL 观测忘了属主过滤：看得见别人的订单',
  layer: 'state',
  symptom: '顾客只下了一杯拿铁，订单列表里冒出一条不属于自己的单',
  mechanism: '在 SQL 直读的 orders 投影里注水一条他人订单（id=1, username=别人），模拟 SELECT 丢了 WHERE username',
  catch_hint: 'count_delta 对「初态也注水」无感（delta 仍是 1）；必须让他人单抢占列表头，'
    + 'field_equals(orders[0].totalAmount) 才会踩到假行判假。',
  applies_to: { capabilities: ['order.create'], collections: ['orders'], adapters: ['taixianglian-sql'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    if (!Array.isArray(state.orders)) return;
    // unshift：他人的单抢占列表头（排序键污染），index 型断言才会真的踩到它。
    state.orders.unshift({
      id: 1, username: 'leaked-customer', status: 'PENDING',
      totalAmount: 1, pickupNo: 101, createTime: null, items: [],
    });
  });
}

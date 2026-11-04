import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-money-off-by-cent',
  title: '金额少一分',
  layer: 'state',
  symptom: '总额被四舍五入错，或者用了单价而不是小计',
  mechanism: '把每笔订单的 totalAmount 减 0.01，其余一切照旧',
  catch_hint: '一条 field_equals 断言 order.totalAmount；只断言"有订单"抓不到',
  applies_to: { collections: ['orders'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    for (const o of s.orders ?? []) {
      if (typeof o.totalAmount === 'number') o.totalAmount = Math.round((o.totalAmount - 0.01) * 100) / 100;
    }
  });
}

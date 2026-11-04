import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-subtotal-stale',
  title: '明细小计漏乘数量',
  layer: 'state',
  symptom: '小票上每一行都写 1 杯的钱，总额却是对的；顾客认为被多收',
  mechanism: '把 items[].subTotal 改成 unitPrice（不乘 count），totalAmount 保持正确',
  catch_hint:
    '必须断言到明细行（items[i].subTotal 或 composite）；只断言 totalAmount 抓不到——总额是对的',
  applies_to: { collections: ['orders'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    for (const o of s.orders ?? []) {
      for (const it of o.items ?? []) {
        if (typeof it.unitPrice === 'number') it.subTotal = it.unitPrice;
      }
    }
  });
}

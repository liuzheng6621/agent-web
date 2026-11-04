import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-item-count-flattened',
  title: '明细数量被拍平',
  layer: 'state',
  symptom: '顾客点了 2 份，订单上显示 1 份；金额却还是 2 份的钱',
  mechanism: '把每条明细的 count 无条件改成 1，subTotal 与总额都不动',
  catch_hint:
    '要断言 items[i].count 或 items[i].subTotal；只断言 totalAmount 抓不到（总额是对的）',
  applies_to: { collections: ['orders'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    for (const o of s.orders ?? []) {
      for (const it of o.items ?? []) {
        if (typeof it.count === 'number') it.count = 1;
      }
    }
  });
}

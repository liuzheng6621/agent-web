import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-total-single-unit',
  title: '总额漏乘数量',
  layer: 'state',
  symptom: '点了 3 杯只收 1 杯的钱；对账时金额对不上流水',
  mechanism: '把 totalAmount 改成所有明细单价之和（不乘 count）',
  catch_hint: '一条 field_equals 断言 order.totalAmount；只断言状态或订单数抓不到',
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    for (const o of s.orders ?? []) {
      const items = o.items ?? [];
      if (items.length === 0) continue;
      const sum = items.reduce((acc, it) => acc + (Number(it.unitPrice) || 0), 0);
      o.totalAmount = Math.round(sum * 100) / 100;
    }
  });
}

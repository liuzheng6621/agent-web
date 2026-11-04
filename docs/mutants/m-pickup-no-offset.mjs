import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-pickup-no-offset',
  title: '取餐号漏了偏移',
  layer: 'state',
  symptom: '取餐号等于订单号，跟历史订单撞号，柜台叫号叫错人',
  mechanism: '把 pickupNo 直接从 id 复制，去掉原本的偏移量',
  catch_hint: '一条 field_equals 断言 order.pickupNo；只断言订单存在抓不到',
  applies_to: { collections: ['orders'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    for (const o of s.orders ?? []) {
      if (typeof o.pickupNo === 'number' && typeof o.id === 'number') o.pickupNo = o.id;
    }
  });
}

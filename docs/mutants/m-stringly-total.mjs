import { wrapState, clone } from './_helpers.mjs';

/**
 * 数字变成字符串。
 *
 * 症状：接口把 totalAmount 序列化成了 "56"，前端拿去做加法会变成 "5628"。
 * 怎么坏：把 orders 里每个 totalAmount 转成字符串。
 * 怎么抓：type_of {collection:'orders', path:'totalAmount', type:'number'}。
 *         field_equals 抓不到 —— "56" 与 56 在某些序列化里看起来差不多，
 *         而且值没变，变的只是类型。
 */
export const meta = {
  id: 'm-stringly-total',
  title: '数字被序列化成字符串',
  layer: 'state',
  symptom: 'totalAmount 是 "56" 而不是 56',
  mechanism: '把总额转成字符串',
  catch_hint: 'type_of on totalAmount',
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state && state.orders;
    if (!Array.isArray(rows)) return;
    rows.forEach((r) => {
      if (r && r.totalAmount !== undefined && r.totalAmount !== null) r.totalAmount = String(r.totalAmount);
    });
  });
}

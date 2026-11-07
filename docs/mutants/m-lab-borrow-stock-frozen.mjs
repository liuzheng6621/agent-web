import { wrapState } from './_helpers.mjs';

// 器材台账最常见的错法：把"总量"当成"可借"。
// 页面上一律显示 5 台可借，借出去两台也不减——直到第三个人来借第三台，
// 才在提交那一刻收到"库存不足"。错的是展示，崩的是信任。
// 只改观测、不改执行，所以能走 certify 的快路径（免重放）。
export const meta = {
  id: 'm-lab-borrow-stock-frozen',
  title: '可借数量永远等于总量（借出不扣库存）',
  layer: 'state',
  symptom: '借出两台之后页面仍显示五台可借，第三个人来了才发现没有',
  mechanism: 'observe 时把 equipment[].availableQuantity 改写成 totalQuantity',
  catch_hint: '只有「借出未还时 availableQuantity === 3」这类中途断言抓得住；'
    + '终态「归还后回到 5」与 count_delta 全过。',
  applies_to: { collections: ['equipment'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state.equipment;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row && 'totalQuantity' in row) row.availableQuantity = row.totalQuantity;
    }
  });
}

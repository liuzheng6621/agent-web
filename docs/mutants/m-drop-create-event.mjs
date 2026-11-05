import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-drop-create-event',
  title: '建了单，流水里没有那条「已下单」',
  layer: 'state',
  symptom: '订单本身正常，审计流水缺了最重要的一条',
  mechanism: '把 status_log 里 type 为 order.created 的行删掉，其它行原样保留',
  catch_hint: 'field_equals 看单行、count_delta 看总数都可能对不上号；需要「凡是订单，流水里必须有它」这种跨实体约束',
  applies_to: { collections: ['status_log'] },
};

export function wrap(adapter) {
  // 注意：tamper 必须**原地改** state，返回新对象等于什么都没做
  // （wrapState 调的是 tamper(state)，不看返回值）。
  return wrapState(adapter, (state) => {
    if (Array.isArray(state.status_log)) {
      state.status_log = state.status_log.filter((r) => r.type !== 'order.created');
    }
  });
}

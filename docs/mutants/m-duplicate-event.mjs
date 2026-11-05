import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-duplicate-event',
  title: '同一件事被记了两遍',
  layer: 'state',
  symptom: '翻流水能看到两条一模一样的事件，界面上完全正常',
  mechanism: '把 status_log 里第一条 order.created 复制一份塞回去（存在性不变，条数变了）',
  catch_hint: '存在性断言照样通过——就得靠「这一行的对应流水必须正好一条」这种数量关系',
  applies_to: { collections: ['status_log'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    if (!Array.isArray(state.status_log)) return;
    const hit = state.status_log.find((r) => r.type === 'order.created');
    if (hit) state.status_log.push({ ...hit, id: (hit.id || 0) + 1000 });
  });
}

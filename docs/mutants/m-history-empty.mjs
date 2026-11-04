import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-history-empty',
  title: '事件流水被吞掉',
  layer: 'state',
  symptom: '迁移发生了但没记日志，或者被清理任务删了',
  mechanism: '把 status_log 清空',
  catch_hint: '按事件类型计数（count_delta 带 where）或 event_absent 的反面；' +
    '"不该有某事件"这类不变式在空集合上真空成立，抓不到',
  applies_to: { collections: ['status_log'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    s.status_log = [];
  });
}

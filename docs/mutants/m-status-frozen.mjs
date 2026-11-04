import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-status-frozen',
  title: '状态永远停在初始值',
  layer: 'state',
  symptom: '状态机没接上，每次读都返回最初的状态',
  mechanism: '把每笔订单的 status 改回 PENDING',
  catch_hint: 'field_equals 或 status_transition；只看"订单存在"抓不到',
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    for (const o of s.orders ?? []) o.status = 'PENDING';
  });
}

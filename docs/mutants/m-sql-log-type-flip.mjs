import { wrapState } from './_helpers.mjs';

// 流水谎报：第一跳明明是「接单」（PENDING→MAKING），观测层把它改成
// 「备好」（order.ready）。位置型断言（index）抓它最直接；状态机断言
// 也会因为边（READY 单跳起步）非法而判假。
export const meta = {
  id: 'm-sql-log-type-flip',
  title: '流水谎报迁移终点：making 被写成 ready',
  layer: 'state',
  symptom: '审计流水显示订单直接备好，没人接过单',
  mechanism: '把 status_log[0].type 从 order.making 改成 order.ready（to 同步改 READY），模拟映射层读错列或视图缓存旧值',
  catch_hint: 'field_equals(status_log[0].type, order.making) 判假；state_machine 对该行报非法起始态。',
  applies_to: { capabilities: ['kitchen.accept'], collections: ['status_log'], adapters: ['taixianglian-sql'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const first = state.status_log?.[0];
    if (!first) return;
    first.type = 'order.ready';
    first.to = 'READY';
  });
}

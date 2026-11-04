export const meta = {
  id: 'm-cancel-noop',
  title: '取消返回成功但什么都没发生',
  layer: 'execute',
  symptom: '接口回 200 说已取消，订单还在等待中，顾客以为取消了没来做',
  mechanism: 'order.cancel 不执行真实迁移，直接返回 applied 与 CANCELED 的 payload',
  catch_hint:
    '只改写动作结局的假成功：终态断言（status 仍是 PENDING）能抓，只看"返回成功"抓不到',
  applies_to: { capabilities: ['order.cancel'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      if (action.capability !== 'order.cancel') return adapter.execute(runId, action);
      return { outcome: 'applied', payload: { orderId: action.arguments?.orderId ?? null, status: 'CANCELED' } };
    },
  };
}

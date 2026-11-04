export const meta = {
  id: 'm-double-create',
  title: '下单被执行两次',
  layer: 'execute',
  symptom: '点了一次提交，出了两张单；顾客被做两杯、付两次钱',
  mechanism: 'order.create 成功后再用同样的入参执行一遍（重复提交没有幂等）',
  catch_hint: '一条 count_delta 断言 orders 的增量必须是 1；只断言"有订单"或"状态对"抓不到',
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const first = await adapter.execute(runId, action);
      if (action.capability !== 'order.create' || first.outcome !== 'applied') return first;
      await adapter.execute(runId, action);
      return first;
    },
  };
}

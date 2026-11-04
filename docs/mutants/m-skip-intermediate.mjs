export const meta = {
  id: 'm-skip-intermediate',
  title: '两步迁移压成一步',
  layer: 'execute',
  symptom: '订单没进过"制作中"，直接从已接单跳到可取餐；审计日志少一段',
  mechanism: '调用 kitchen.accept 时连做 accept + ready，中间态一闪而过',
  catch_hint: '只能靠 status_transition 的完整序列；只看终态的实现会以为一切正常',
  applies_to: { capabilities: ['kitchen.accept', 'kitchen.ready'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (action.capability !== 'kitchen.accept') return res;
      const orderId = action.arguments?.orderId ?? action.bindings?.orderId ?? null;
      if (!orderId) return res;
      await adapter.execute(runId, { capability: 'kitchen.ready', as: 'staff', arguments: { orderId } });
      return res;
    },
  };
}

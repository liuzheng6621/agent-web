export const meta = {
  id: 'm-exec-drop-intermediate',
  title: '中间那一步没发生',
  layer: 'execute',
  symptom: '终态一样，流水少一跳（PENDING 直接到 READY）',
  mechanism: '把第一次迁移类调用改成空操作（仍报成功），只留首尾两次',
  catch_hint: 'status_transition 精确写法或 flow 形状；只看终态状态的断言抓不住',
  // 这个变异体只对名称像迁移的动作下药；没有这类能力的域不算它的分母。
  applies_to: {
    capabilities_any: [
      'kitchen.accept',
      'kitchen.ready',
      'reservations.approve',
      'borrow.approve',
      'adoptions.approve',
      'picking.approve',
    ],
  },
};

const SWITCH = /(accept|ready|transition|approve)/;

export function wrap(adapter) {
  let dropped = 0;
  return {
    ...adapter,
    async execute(runId, action) {
      if (dropped < 1 && SWITCH.test(String(action && action.capability))) {
        dropped += 1;
        return { outcome: 'applied', payload: { dropped: true }, error: null };
      }
      return adapter.execute(runId, action);
    },
  };
}

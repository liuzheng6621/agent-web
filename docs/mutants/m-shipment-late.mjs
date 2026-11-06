// 发货（或任何「终点事件」）迟了：状态完全正确，事件顺序完全正确，
// 只有时间戳晚了。任何基于步号的断言都看不见它 —— 这正是 timeliness 存在的理由。
//
// 手法：把终点事件的 at 往后推 max_ms + 1ms，其余一字不动。
export const meta = {
  id: 'm-shipment-late',
  layer: 'state',
  title: '终点事件晚了（时间戳被推后）',
  why: '状态与顺序都对，只有时间不对：步号坐标的断言一律看不见',
  kind: 'state',
  symptom: '状态对、顺序对，只有时间戳不对',
  mechanism: 'observe 时把 order.picked 那行的 at 推后 25 小时',
  catch_hint: 'timeliness{from:{type:"order.created"},to:{type:"order.picked"},max:"24h",timezone:"UTC"}',
  applies_to: { collections: ['status_log'] },
};

// 它只改 observe 的返回，不碰 state 本体，所以没有 tamper 可声明：
// 快路径（直接变换 ctx）复现不了它，会退回重放。这是边界，不是漏洞。
export function wrap(inner, options = {}) {
  const lateBy = options.lateBy ?? 25 * 3600000; // 25 小时
  const targetType = options.targetType ?? 'order.picked';

  return {
    ...inner,
    async observe(runId) {
      const snap = await inner.observe(runId);
      const log = snap?.state?.status_log;
      if (!Array.isArray(log)) return snap;
      const idx = log.map((r) => r?.type).lastIndexOf(targetType);
      if (idx < 0) return snap;
      const rows = log.map((r, i) => (i === idx ? { ...r, at: Number(r.at) + lateBy } : r));
      return { ...snap, state: { ...snap.state, status_log: rows } };
    },
  };
}

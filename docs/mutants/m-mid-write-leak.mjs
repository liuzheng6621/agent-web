// 被拒绝的那一步之后，留下半条记录，最后又清掉。
// 净变化为零、终态干净：initial_vs_final 类断言全过。
// 只有把观察窗口缩到那一步之后（window）才能看见。
export const meta = {
  id: 'm-mid-write-leak',
  title: '被拒绝之后留了半条流水，收尾时又抹掉',
  layer: 'state',
  symptom: '净变化为零、终态干净，但中间确实多写过一行',
  mechanism: '只在第 2 步之后的快照里往 status_log 塞一条假记录，其余快照不动',
  catch_hint: '把窗口缩到「那一步之后」（window），盯住中间那段',
};

export function wrap(adapter) {
  const tamper = (state, index, count) => {
    if (index !== 2 || count < 5 || index >= count - 1) return;
    if (!state || typeof state !== 'object') return;
    const log = state.status_log;
    if (!Array.isArray(log)) return;
    log.push({ id: 990001, type: 'order.leaked', orderId: 0, from: null, to: 'PENDING', by: 'nobody', at: 0 });
  };
  return Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, {
    _agentWebStateFn: tamper,
  });
}

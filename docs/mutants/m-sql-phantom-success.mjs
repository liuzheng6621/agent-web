import { clone } from './_helpers.mjs';

// 幽灵成功是 L2（写后事实层）的定义性敌人：执行通道报 applied，
// 但写根本没发生——数据库里查无此单。HTTP 视图可能有缓存、可能有假象，
// 只有独立第二通道（SQL 直读）能拆穿「报了成功但事实不存在」。
// 抓它的不是新断言，而是让断言跑在**不信执行通道的观测**上。
export const meta = {
  id: 'm-sql-phantom-success',
  title: '幽灵成功：execute 报 applied，订单没落库',
  layer: 'execute',
  symptom: '下单接口返回成功、页面也跳转了，但账房（数据库）里从来没有这张单',
  mechanism: '拦截 order.create，不调后端，直接伪造一份 applied 响应（orderId=-999）；观测通道保持真实',
  catch_hint: 'count_delta=1 与 entity_exists 在 SQL 直读通道上必然判假——执行通道的话不可信，事实层的账要对上。',
  applies_to: { capabilities: ['order.create'], adapters: ['taixianglian-sql'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      if (action?.capability !== 'order.create') return adapter.execute(runId, action);
      // 幽灵：报成功，不执行。观测通道（SQL）随后会照实说：查无此单。
      return {
        outcome: 'applied',
        error: null,
        payload: { orderId: -999, totalAmount: 28, status: 'PENDING' },
        trace: { phantom: true },
      };
    },
    // state 变异体凭据不挂：观测是诚实的，幽灵死在事实上。
    _agentWebStateFn: undefined,
    clone,
  };
}

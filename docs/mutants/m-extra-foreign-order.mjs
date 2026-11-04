import { clone, wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-extra-foreign-order',
  title: '列表里混进别人的订单',
  layer: 'state',
  symptom: '查询没按当前用户过滤，别人的单出现在我的列表里',
  mechanism: '复制一条订单、改掉 id 与 username 后追加进 orders',
  catch_hint: 'count_delta 断言订单数；和"订单存在"这类断言无关',
};

export function wrap(adapter) {
  return wrapState(adapter, (s) => {
    if (!Array.isArray(s.orders) || s.orders.length === 0) return;
    const ghost = clone(s.orders[0]);
    ghost.id = (ghost.id ?? 0) + 500000;
    ghost.username = 'somebody-else';
    s.orders.push(ghost);
  });
}

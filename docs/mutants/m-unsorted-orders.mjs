import { wrapState, clone } from './_helpers.mjs';

/**
 * 列表顺序被打乱。
 *
 * 症状：订单列表不再按创建时间排，最新的一条跑到最后。
 * 怎么坏：把 orders 顺序整个反过来。
 * 怎么抓：sorted_by {collection:'orders', path:'createTime', order:'asc'}。
 *         用「第 0 行是 X」抓不住 —— 它依赖行号，换个实现行号就不一样。
 *         sorted_by 说的是「这个序列的走向」，与行号无关，可移植。
 */
export const meta = {
  id: 'm-unsorted-orders',
  title: '列表不再按创建时间排',
  layer: 'state',
  symptom: '最新创建的订单跑到列表最后',
  mechanism: '把 orders 顺序反转',
  catch_hint: 'sorted_by on createTime',
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    if (state && Array.isArray(state.orders)) state.orders.reverse();
  });
}

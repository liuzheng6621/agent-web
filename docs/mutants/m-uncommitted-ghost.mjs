import { wrapState } from './_helpers.mjs';

/**
 * 幻影行：一条后端根本不存在的订单出现在列表里。
 *
 * 症状：列表比真实多一行，id 是没人创建过的。
 * 怎么坏：每次 observe 都往 orders 注入一条幽灵订单（id=999999，没人创建过）。
 *         模拟「隔离级别退化读到未提交事务的行 / 连错了库 / 视图吞了别人的会话」。
 *         它与 m-duplicate-row 的分工：duplicate-row 是**复制真实行**（条数不变），
 *         抓它靠 unique；ghost 是**多出一行**（条数变了），抓它靠 count_delta。
 *         如果 ghost 只是改值不改行数，count_delta 就没有独占战功，这条就不该存在。
 * 怎么抓：count_delta {collection:'orders', delta:1} —— 幻影行让终态多一行，delta 变 2 → 判假。
 *         unique on id 也能顺手抓（幽灵 id 与真实行不同，条数+1 后 id 依然唯一）——所以
 *         unique 在这里不是独占，count_delta 才是这条变异体的存在理由。
 */
export const meta = {
  id: 'm-uncommitted-ghost',
  title: '幻影行：列表多出一条没人创建过的订单',
  layer: 'state',
  symptom: '订单数比真实多一行，id 无人创建',
  mechanism: '每次 observe 往 orders 注入独立幽灵行 id=999999，模拟隔离级别退化读到未提交行或视图吞了别的会话',
  catch_hint: 'count_delta(orders, 1) 判假（幻影让 delta 变 2）；unique(orders.id) 也能抓但非独占。',
  applies_to: { capabilities: ['order.create'], collections: ['orders'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state.orders;
    if (!Array.isArray(rows)) return;
    if (rows.some((r) => r && r.id === 999999)) return;
    rows.push({ id: 999999, username: 'ghost-uncommitted', status: 'PENDING', totalAmount: 0.01, pickupNo: null, items: [] });
  });
}

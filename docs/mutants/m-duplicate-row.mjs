import { wrapState, clone } from './_helpers.mjs';

/**
 * 同一行出现两次。
 *
 * 症状：列表里两条记录的 id 一样。
 * 怎么坏：把 orders 的最后一行覆盖成第一行的副本 —— 条数不变，内容重复。
 *         这一条很关键：如果只是"多插一行"，count_delta 也会抓到它，
 *         unique 就永远拿不到独占战功，那它就不该存在。
 * 怎么抓：unique {collection:'orders', path:'id'} —— 注意它断言的是「唯一」这件结构事实，
 *         不是某个 id 等于多少。id 的具体值不可移植，但「不能重复」可移植。
 */
export const meta = {
  id: 'm-duplicate-row',
  title: '同一行出现两次',
  layer: 'state',
  symptom: '列表里两条记录的 id 一样',
  mechanism: '把最后一行覆盖成第一行的副本，条数不变',
  catch_hint: 'unique on id',
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state && state.orders;
    if (!Array.isArray(rows) || rows.length < 2) return;
    rows[rows.length - 1] = clone(rows[0]);
  });
}

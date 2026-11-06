/**
 * 词库域：列表没有 ORDER BY，返回顺序不稳定。
 *
 * 症状：同一份词库，第一次查 rank 是 1,2,3…，第二次变成 7,3,19…
 *       翻页时同一行会出现在两页里、也会有一行两页都不出现 —— 而每一页都是满的。
 * 怎么坏：SQL 少了 ORDER BY。MySQL 在没有 ORDER BY 时不保证顺序，
 *         索引选择一变（统计信息更新、加了条件、换了驱动）顺序就变。
 * 怎么抓：sorted_by { path:'rank', order:'asc' } —— 断的是**顺序**，不是内容。
 *         unique 与 count_delta 都抓不住：行还是那些行，只是次序乱了。
 */
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-lexicon-unsorted',
  title: '列表没加 ORDER BY，返回顺序不稳定',
  layer: 'state',
  symptom: '词库顺序随机变化，翻页时同一行出现在两页里',
  mechanism: '查询少了 ORDER BY，数据库按自己的心情返回',
  catch_hint: 'sorted_by { path:"rank", order:"asc" }',
  applies_to: { collections: ['entries'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state?.entries;
    if (!Array.isArray(rows) || rows.length < 3) return;
    // 确定性打乱：把前 3 条倒过来。用固定变换而不是 Math.random，
    // 否则同一个变异体两次跑出不同结果，certify 的判决会漂。
    const head = rows.slice(0, 3).reverse();
    rows.splice(0, 3, ...head);
  });
}

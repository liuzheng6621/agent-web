/**
 * 词库域：类别字段越界。
 *
 * 症状：前端按类别做筛选，出现一个「其它」分组里躺着几条，点进去是空的；
 *       或者颜色映射表查不到 key，渲染成一片灰。
 * 怎么坏：类别是自由文本字段，没有枚举约束，脏数据（'nature ' 带空格、'NATURE'、
 *         '未知'）直接从导入脚本进了库。
 * 怎么抓：subset { path:'category', values:[...] } —— 断的是**值域**，
 *         type_of 抓不住（还是字符串），unique 也抓不住（不重复）。
 */
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-lexicon-category-out-of-enum',
  title: '类别字段出现枚举外的值',
  layer: 'state',
  symptom: "category 里混进 'misc'，前端筛选分组多出一个空组",
  mechanism: '类别是自由文本，导入时没做值域校验',
  catch_hint: 'subset { path:"category", values:[...] }',
  applies_to: { collections: ['entries'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state?.entries;
    if (!Array.isArray(rows) || rows.length === 0) return;
    rows[0].category = 'misc';
  });
}

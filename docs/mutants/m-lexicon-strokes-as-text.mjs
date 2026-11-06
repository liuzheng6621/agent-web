/**
 * 词库域：笔画数变成字符串。
 *
 * 症状：前端拿 "12" 去做算术，得到 "121"，排序按字典序把 "9" 排在 "10" 后面。
 * 怎么坏：后端把数字字段序列化成字符串（很多 ORM / JSON 配置会这么干）。
 * 怎么抓：type_of { path:'strokes', type:'integer' } —— field_equals 抓不住，
 *         因为值看起来「一样」，只是类型变了。
 */
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-lexicon-strokes-as-text',
  title: '笔画数被序列化成字符串',
  layer: 'state',
  symptom: 'strokes 从 12 变成 "12"，排序变成字典序',
  mechanism: '数字字段在投影时没有转回 number',
  catch_hint: 'type_of { path:"strokes", type:"integer" }',
  applies_to: { collections: ['entries'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state?.entries;
    if (!Array.isArray(rows)) return;
    for (const row of rows) if (row.strokes !== undefined) row.strokes = String(row.strokes);
  });
}

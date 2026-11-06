/**
 * 词库域：分词吞掉了最后一个词。
 *
 * 症状：「长江大桥」切成 ['长江']，或者切出 ['长江','大'] 把「桥」丢了。
 *       搜索侧按 token 建倒排，「桥」这个字永远搜不到任何东西。
 * 怎么坏：循环条件写成 i < text.length - 1，或分词结束没有 flush 缓冲区。
 * 怎么抓：field_equals { collection:'segments', path:'tokens', value:[...] } ——
 *         断的是**数组整体**，不是长度：少一个和换一个都要红。
 *         count_delta 抓不住：分词不增删词条，segments 的行数也没变。
 */
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-lexicon-segment-truncate',
  title: '分词吞掉最后一个词',
  layer: 'state',
  symptom: "「长江大桥」只切出 ['长江']，末词丢失",
  mechanism: '循环边界少算一位，或结尾没 flush 缓冲区',
  catch_hint: 'field_equals { path:"tokens", value:["长江","大桥"] }',
  applies_to: { collections: ['segments'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const segs = state?.segments;
    if (!Array.isArray(segs) || segs.length === 0) return;
    for (const s of segs) {
      if (Array.isArray(s.tokens) && s.tokens.length > 1) s.tokens = s.tokens.slice(0, -1);
    }
  });
}

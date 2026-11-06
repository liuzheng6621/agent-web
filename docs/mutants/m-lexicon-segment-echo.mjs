/**
 * 词库域：分词返回的原文与输入不一致。
 *
 * 症状：传「长江大桥」，返回的 text 变成「长江大桥 」或多了一个看不见的零宽字符。
 *       调用方拿返回的 text 当缓存 key，同一句话第二次查不到，缓存永不命中。
 * 怎么坏：接口在返回前对输入做了归一化（trim / 全角转半角 / 去重标点），
 *         但只在返回值上做，没有回写调用方的那份 key。
 * 怎么抓：field_equals { collection:'segments', path:'text', value:'长江大桥' } ——
 *         断的是**回显**，tokens 完全正确也照样红。
 */
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-lexicon-segment-echo',
  title: '分词回显的原文被悄悄归一化',
  layer: 'state',
  symptom: '返回的 text 与传入的不一致，调用方拿它当缓存 key 就永远不命中',
  mechanism: '返回前对输入做了归一化，没有回写调用方的 key',
  catch_hint: "field_equals { path:'text', value:'长江大桥' }",
  applies_to: { collections: ['segments'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const segs = state?.segments;
    if (!Array.isArray(segs) || segs.length === 0) return;
    for (const s of segs) {
      if (typeof s.text === 'string' && s.text.length > 0) s.text = s.text.trim() + '\u200b';
    }
  });
}

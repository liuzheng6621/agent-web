/**
 * 词库域：两条词条共用一个 id。
 *
 * 症状：按 id 取词时随机拿到另一条，缓存键冲突后整页内容会串。
 * 怎么坏：id 生成器用了「首字+末字」之类的组合，没保证唯一。
 * 怎么抓：unique { collection:'entries', path:'id' } —— 这是结构断言，与行号无关。
 */
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-lexicon-duplicate-id',
  title: '两条词条共用一个 id',
  layer: 'state',
  symptom: '词库里出现两条 id 相同的词条，按 id 取词会串',
  mechanism: 'id 生成不保证唯一，第二条直接复用了第一条的 id',
  catch_hint: 'unique { collection:"entries", path:"id" }',
  applies_to: { collections: ['entries'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state?.entries;
    if (!Array.isArray(rows) || rows.length < 2) return;
    rows[1].id = rows[0].id;
  });
}

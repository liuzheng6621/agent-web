/**
 * 词库域：total 报的是全库，不是命中数。
 *
 * 症状：前缀 chang 命中 30 条，返回体里 total 却是 900。前端据此算「还有 90 页」，
 *       用户翻到第 4 页就是空的。
 * 怎么坏：分页实现忘了把 total 换成过滤后的条数，直接用了整表长度。
 * 怎么抓：pagination 里写死 total:30 —— 报 900 就是假话，与「某一页看起来对不对」无关。
 */
export const meta = {
  id: 'm-lexicon-total-lies',
  title: 'total 报全库而不是命中数',
  layer: 'execute',
  symptom: '前缀命中 30 条，total 却写 900，翻页翻到后面全是空的',
  mechanism: '过滤后没重算 total，直接用了整表长度',
  catch_hint: 'pagination { total: 30 } 断言命中数，而不是只看当前页条数',
  applies_to: { capabilities: ['lexicon.list'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (action.capability !== 'lexicon.list') return res;
      if (!res.payload || typeof res.payload.total !== 'number') return res;
      return { ...res, payload: { ...res.payload, total: 900 } };
    },
  };
}

/**
 * 词库域：第二页少给一条。
 *
 * 症状：前缀 chang 共 30 条、每页 10 条，翻到第二页只回来 9 条。
 * 怎么坏：分页边界算成 start + pageSize - 1，每页都丢尾行，每页看着都「有条」。
 * 怎么抓：pagination 声明 total 与 pageSize，把各页拼起来比对条数与连续性；
 *         单看某一页的 count_delta 永远是对的。
 */
export const meta = {
  id: 'm-lexicon-page-drop',
  title: '第二页少给一条',
  layer: 'execute',
  symptom: '前缀查询翻到第二页只有 9 条，实际该有 10 条',
  mechanism: '分页右边界算成 start + pageSize - 1，每页丢最后一行',
  catch_hint: 'pagination { steps:[1,2,3], total, pageSize } 把各页拼起来数',
  applies_to: { capabilities: ['lexicon.list'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (action.capability !== 'lexicon.list') return res;
      if (Number(action.arguments?.page) !== 2) return res;
      const rows = res.payload?.entries;
      if (!Array.isArray(rows) || rows.length < 2) return res;
      return { ...res, payload: { ...res.payload, entries: rows.slice(0, -1) } };
    },
  };
}

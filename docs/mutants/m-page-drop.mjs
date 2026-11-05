export const meta = {
  id: 'm-page-drop',
  title: '最后一页少给一条',
  layer: 'execute',
  symptom: '翻到第二页只回来一条，实际应该有两条；顾客翻完发现订单少了一单',
  mechanism:
    '分页边界算错（end = start + pageSize - 1，或 limit 传成了 pageSize-1），每页都少给尾行。每页都还「有条」，total 也可能报对。',
  catch_hint:
    '一条 pagination 断言声明 total 与 pageSize，把各页条数加起来比对；只看某一页的条数永远看不出来',
  applies_to: { capabilities: ['order.list'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (action.capability !== 'order.list') return res;
      if (Number(action.arguments?.page) !== 2) return res;
      const rows = res.payload?.orders;
      if (!Array.isArray(rows) || rows.length < 2) return res;
      return { ...res, payload: { ...res.payload, orders: rows.slice(0, -1) } };
    },
  };
}

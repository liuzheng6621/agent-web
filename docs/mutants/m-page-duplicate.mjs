export const meta = {
  id: 'm-page-duplicate',
  title: '翻页时同一行出现两次',
  layer: 'execute',
  symptom: '翻到第二页，第一页的最后一条又出现一次；导出报表时这单被算了两遍',
  mechanism:
    '列表接口在取第二页时把上一页的末行也带上（游标用了 >= 而不是 >，或 offset 少减 1）。每一页单看都正常：条数对、字段对、状态对。',
  catch_hint:
    '一条 pagination 断言把这几个翻页步的返回拼起来查重；逐页的 count_delta 和 field_equals 全是绿的，抓不到',
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
      if (!Array.isArray(rows) || rows.length === 0) return res;
      return {
        ...res,
        payload: { ...res.payload, orders: [rows[0], ...rows] },
      };
    },
  };
}

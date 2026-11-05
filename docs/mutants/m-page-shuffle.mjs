export const meta = {
  id: 'm-page-shuffle',
  title: '翻页顺序乱了',
  layer: 'execute',
  symptom: '第一页按时间倒序，第二页又变成正序；顾客翻页时看到同一批数据忽前忽后',
  mechanism: '排序键在两次查询里不一致（一次 createdAt、一次 id，或分页时丢了 ORDER BY）。每页内部看着都有序。',
  catch_hint: '一条 pagination 断言带 ordered_by，按页次拼接后检查单调性；单页检查看不出来',
  applies_to: { capabilities: ['order.list'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (action.capability !== 'order.list') return res;
      if (Number(action.arguments?.page) !== 1) return res;
      const rows = res.payload?.orders;
      if (!Array.isArray(rows) || rows.length < 2) return res;
      return { ...res, payload: { ...res.payload, orders: [...rows].reverse() } };
    },
  };
}

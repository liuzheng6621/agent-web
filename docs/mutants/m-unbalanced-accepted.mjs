export const meta = {
  id: 'm-unbalanced-accepted',
  title: '不平的分录也收下了',
  layer: 'execute',
  symptom: '接口回 200，账上多了一笔，借贷差永远挂在账里',
  mechanism: '把 transaction.post 的拒收改成「成功」，其它能力的拒收照旧',
  catch_hint: '负例案例的 count_delta / unchanged 抓得住；只测正例的套件完全看不见',
  applies_to: { collections: ['transactions'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      const cap = String(action && action.capability);
      if (res && res.outcome === 'rejected' && /(transaction\.post|posting\.create)/.test(cap)) {
        return { outcome: 'applied', payload: { ...(res.payload || {}), forced: true }, error: null };
      }
      return res;
    },
  };
}

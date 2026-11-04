export const meta = {
  id: 'm-ledger-any-balance',
  title: '借贷不平也照记',
  layer: 'execute',
  symptom: '不平衡的账也报成功——接口说了 applied，账本里其实没落',
  mechanism: '去掉平衡校验并假装入账（返回 applied，账本没写）——「接口撒谎」是一整类真实故障',
  catch_hint: '靠负例步的 expected_outcome=rejected，判决签名从 expected_rejection 变成 applied；终态断言看不见，因为账本根本没变',
  applies_to: { capabilities: ['transaction.post'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (action.capability !== 'transaction.post' || res.outcome !== 'rejected') return res;
      return { outcome: 'applied', identity: res.identity, payload: { transactionId: -1 } };
    },
  };
}

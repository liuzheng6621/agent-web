import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-ledger-total-lies',
  title: '交易合计报了个正数',
  layer: 'state',
  symptom: '借贷明明相等，交易上的合计却显示 100——对账的人以为不平',
  mechanism: '把 transaction.total 改成借方金额之和（应该恒为 0）',
  catch_hint: '要一条 field_equals 断言 total 等于 0；只断言「有交易」看不见',
  applies_to: { collections: ['transactions'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    if (!Array.isArray(state.transactions)) return;
    for (const tx of state.transactions) {
      const debit = (tx.entries ?? [])
        .filter((e) => e.direction === 'debit')
        .reduce((s, e) => s + Number(e.amount ?? 0), 0);
      tx.total = debit;
    }
  });
}

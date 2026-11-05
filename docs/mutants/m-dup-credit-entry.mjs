import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-dup-credit-entry',
  title: '贷方那条被记了两遍',
  layer: 'state',
  symptom: '交易总数没变、描述没变，但某个账户的余额多了一倍',
  mechanism: '把每笔交易里 direction=credit 的分录复制一条，借方不动',
  catch_hint: '只有「账户余额」这类业务断言看得见；看交易条数与描述的断言全过',
  applies_to: { collections: ['transactions'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    if (!Array.isArray(state.transactions)) return;
    for (const t of state.transactions) {
      if (!Array.isArray(t.entries)) continue;
      const credits = t.entries.filter((e) => e.direction === 'credit');
      for (const c of credits) t.entries.push({ ...c });
    }
  });
}

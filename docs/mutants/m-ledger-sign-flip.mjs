import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-ledger-sign-flip',
  title: '贷方余额符号写反',
  layer: 'state',
  symptom: '现金看着是 100，收入也是 100——账面上凭空多了 200',
  mechanism: '试算平衡表里把贷方余额的负号去掉',
  catch_hint: '要一条针对具体账户 balance 的 field_equals；断言「余额不为空」抓不到',
  applies_to: { collections: ['trial'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    if (!Array.isArray(state.trial)) return;
    for (const row of state.trial) {
      if (typeof row.balance === 'number' && row.balance < 0) row.balance = -row.balance;
    }
  });
}

import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-illegal-transition-allowed',
  layer: 'state',
  title: '流水末尾多出一条往回走的边（PICKED → MAKING）',
  symptom: '四条声明的迁移全都出现过，订单终态也对，但流水里多了一条未声明的边',
  mechanism: '在最后一个快照的 status_log 末尾追加一条 from=PICKED to=MAKING 的记录',
  catch_hint: 'status_transition 只查「声明的边出现过」——四条都在，它照样判真；要抓它必须声明「只许走这些边」',
  applies_to: { collections: ['status_log'] },
};

// 为什么要追加在末尾而不是改中间态：只改中间态会把某条声明边抹掉，
// status_transition 立刻判假，这个变异体就失去「只有 state_machine 抓得住」的性质。
// 追加一条多余的边，声明边一条不少，只有「只许走这些边」这句话能发现它。
export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    if (!Array.isArray(state.status_log) || state.status_log.length === 0) return;
    const last = state.status_log[state.status_log.length - 1];
    if (last.to !== 'PICKED') return;
    state.status_log.push({
      id: state.status_log.length + 1,
      type: 'order.making',
      orderId: last.orderId,
      from: 'PICKED',
      to: 'MAKING',
      by: last.by,
      at: Number(last.at) + 1000,
    });
  });
}

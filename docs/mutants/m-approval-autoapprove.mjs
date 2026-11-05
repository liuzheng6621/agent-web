import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-approval-autoapprove',
  title: '审批被跳过了',
  layer: 'state',
  symptom: '申请刚提交就已经是「已批准」，中间没有人做过决定',
  mechanism: '把所有 PENDING 的申请直接改成 APPROVED，并补一个 reviewer',
  catch_hint: '只有「刚提交必须是待审批」这类状态断言抓得住；只看条数或实体的断言全过',
  applies_to: { collections: ['adoption_applications'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state.adoption_applications || state.adoptions;
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (r && r.status === 'PENDING') {
        r.status = 'APPROVED';
        if ('reviewer' in r) r.reviewer = 'system';
        if ('reviewComment' in r) r.reviewComment = 'auto approved';
      }
    }
  });
}

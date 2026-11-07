import { wrapExecuteAfter } from './_helpers.mjs';

// 批准是一次性的：只有 pending 能被批准。已经批过的预约再批一次，后端会抛
// RESERVATION_STATE_INVALID（"Only pending reservation can be approved or rejected"）。
// 漏判它的实现是"幂等到没底线"：连点两下批准都成功，审计里躺着两条批准记录，
// 谁批的、批了几次、哪次算数，事后谁也说不清。
export const meta = {
  id: 'm-lab-approve-not-pending',
  title: '已经批过的还能再批（批准没查状态）',
  layer: 'execute',
  symptom: '教师连点两下批准，两次都成功；审计里同一条预约出现两条批准记录',
  mechanism: '把 reservations.approve 的 RESERVATION_STATE_INVALID 拒绝改成 applied',
  catch_hint: '要有「同一条预约批两次，第二次必须被拒」这条案例；'
    + '只看最终 status=approved 的断言全过——它本来就该是 approved。',
  applies_to: { capabilities: ['reservations.approve'] },
};

export function wrap(adapter) {
  return wrapExecuteAfter(adapter, (action, res) => {
    if (action?.capability !== 'reservations.approve') return res;
    if (res?.outcome !== 'rejected') return res;
    if (res?.error?.code !== 'RESERVATION_STATE_INVALID') return res;
    return { ...res, outcome: 'applied', error: null, payload: { status: 'approved' } };
  });
}

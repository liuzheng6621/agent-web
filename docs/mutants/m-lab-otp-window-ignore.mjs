import { wrapExecuteAfter } from './_helpers.mjs';

// 门禁口令是**限时**的：只有到了预约时段才签得出来。
// 后端 AccessServiceImpl.isWithinAccessWindow 判的是 startAt <= now < endAt，
// 早一分钟都不行（ACCESS_WINDOW_INVALID）。
// 漏判它的实现最讨人喜欢：学生随时都能点开二维码，页面从来没报过错。
// 代价是这张码在时段外根本刷不开门——用户到门口才发现，而不是在手机上。
export const meta = {
  id: 'm-lab-otp-window-ignore',
  title: '门禁口令提前发出（时间窗没判）',
  layer: 'execute',
  symptom: '预约还有两小时才开始，学生手机上已经有门禁口令了；到点以前那扇门并不会开',
  mechanism: '把 access.otp 的 ACCESS_WINDOW_INVALID 拒绝改成 applied，伪造一份 validFrom=now、expiresAt=now+5min 的凭证',
  catch_hint: '「时段没到就取口令必须被拒」这条 expected_outcome: rejected 是唯一抓法；'
    + '只看凭证面字段的断言全过。',
  applies_to: { capabilities: ['access.otp'] },
};

export function wrap(adapter) {
  return wrapExecuteAfter(adapter, (action, res) => {
    if (action?.capability !== 'access.otp') return res;
    if (res?.outcome !== 'rejected') return res;
    if (res?.error?.code !== 'ACCESS_WINDOW_INVALID') return res;
    const now = new Date();
    const iso = (ms) => new Date(ms).toISOString();
    return {
      ...res,
      outcome: 'applied',
      error: null,
      payload: {
        scope: 'laboratory',
        validFrom: iso(now.getTime()),
        expiresAt: iso(now.getTime() + 5 * 60_000),
        reservationId: Number(action?.arguments?.reservationId ?? -1),
      },
    };
  });
}

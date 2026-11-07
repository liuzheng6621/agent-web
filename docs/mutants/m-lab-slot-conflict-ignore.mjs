import { wrapExecuteAfter } from './_helpers.mjs';

// 实验室的时段是**排他**的：同一间屋子、同一段时间，只能有一条 pending/approved 的预约。
// 这条规则不是"容量 2 就允许两个人"，而是"同一时段只能有一个人"——后端
// StudentServiceImpl.ensureLaboratorySlotAvailable 里只要时间区间相交就抛 RESERVATION_CONFLICT。
// 漏判它的实现看起来一切正常：第一条预约成立，第二条也"成功"，直到两个学生同时站在门口。
export const meta = {
  id: 'm-lab-slot-conflict-ignore',
  title: '同一时段被约了两次（时段排他没判）',
  layer: 'execute',
  symptom: '两个学生约同一间实验室的同一时段都提示成功，到点两个人撞在同一间屋子里',
  mechanism: '把 reservations.create 的 RESERVATION_CONFLICT 拒绝改成 applied，编一个不存在的 reservationId',
  catch_hint: '只有「第二次必须被拒」这条 expected_outcome: rejected 抓得住；'
    + '数条数、看状态的断言全过——伪造的成功背后并没有真的多出一行。',
  applies_to: { capabilities: ['reservations.create'] },
};

export function wrap(adapter) {
  return wrapExecuteAfter(adapter, (action, res) => {
    if (action?.capability !== 'reservations.create') return res;
    if (res?.outcome !== 'rejected') return res;
    if (res?.error?.code !== 'RESERVATION_CONFLICT') return res;
    return { ...res, outcome: 'applied', error: null, payload: { reservationId: -1, status: 'pending' } };
  });
}

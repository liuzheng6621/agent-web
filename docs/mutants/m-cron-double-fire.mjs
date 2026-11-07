import { wrapState } from './_helpers.mjs';

// 调度器最常见的错法：同一槽位被触发两次。
// 起因通常是「推进游标」和「提交任务」不在同一个事务里，重试就把同一个槽位又跑了一遍。
// 后果不是「多一条记录」，是业务动作被执行两次——对账脚本会把钱算两遍。
export const meta = {
  id: 'm-cron-double-fire',
  title: '同一槽位被触发两次（游标没随提交一起前进）',
  layer: 'state',
  symptom: '同一条任务记录出现两次，时间戳一模一样；下游动作因此执行了两遍',
  mechanism: 'observe 时把 runs 的中间一条复制一份，scheduledFor 完全相同',
  catch_hint: 'recurrence 判 recurrence_duplicated，unique(scheduledFor) 也会红；'
    + 'count_delta 单独看只是「多一条」，说不出「是同一次跑了两遍」。',
  applies_to: { collections: ['runs'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state.runs;
    if (!Array.isArray(rows) || rows.length < 2) return;
    const mid = Math.floor(rows.length / 2);
    rows.splice(mid, 0, { ...rows[mid] });
  });
}

import { wrapState } from './_helpers.mjs';

// 定时任务最贵的错法：静默漏跑。
// 没有报警、没有红色、任务表上写着「已启用」，只是某几个槽位从来没发生过。
// 只有拿节律去对，才知道第 7 个槽位是空的——数总数会被「别的槽位多跑一次」掩盖。
export const meta = {
  id: 'm-cron-skip-slot',
  title: '每第 4 个槽位静默漏跑一次',
  layer: 'state',
  symptom: '任务看起来一直在跑，翻记录才发现某几个时间点根本没有执行过',
  mechanism: 'observe 时把 runs 里每第 4 条删掉',
  catch_hint: 'recurrence 判「漏跑几个槽位」；只看 count_delta 的实现若同时多跑一次，总数还能对上。',
  applies_to: { collections: ['runs'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state.runs;
    if (!Array.isArray(rows)) return;
    state.runs = rows.filter((_, i) => i % 4 !== 3);
  });
}

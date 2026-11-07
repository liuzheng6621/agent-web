import { wrapState } from './_helpers.mjs';

// 「差不多准时」的坏法：每次都比该跑的时刻晚 20 分钟。
// 总数对、不重复、不漏，任何只看「跑了几次」的断言全过——
// 但对业务来说，本该 00:15 出的报表一直到 00:35 才有，
// 依赖它的下游（对账、告警、结算）全部错位。
// 这一维 count_delta 表达不了，unique 表达不了，只有节律 + 容差说得清。
export const meta = {
  id: 'm-cron-drift',
  title: '每个槽位都晚 20 分钟（次数全对，时刻全错）',
  layer: 'state',
  symptom: '记录条数、顺序、唯一性都没问题，只是每一次都比计划晚 20 分钟',
  mechanism: 'observe 时把 runs[].scheduledFor 整体后移 20 分钟',
  catch_hint: '只有 recurrence（且 tolerance_ms 小于 20 分钟）抓得住；'
    + 'count_delta 与 unique 全过，因为数量与唯一性都没变。',
  applies_to: { collections: ['runs'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state.runs;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row.scheduledFor !== 'string') continue;
      const t = Date.parse(row.scheduledFor);
      if (!Number.isFinite(t)) continue;
      row.scheduledFor = new Date(t + 20 * 60000).toISOString();
    }
  });
}

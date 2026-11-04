export const meta = {
  id: 'm-double-effect',
  title: '一次操作记了两次账',
  layer: 'state',
  symptom: '只出餐一次，流水里出现两条；积分加两遍、库存扣两回',
  mechanism: '把最后一条状态流水原地复制一份——动作确实只发生了一次，账却记了两遍',
  catch_hint: '要一条针对具体事件类型的 count_delta（如 order.ready 的增量为 2）；断言「有流水」看不见',
};

import { clone, wrapState } from './_helpers.mjs';

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const log = state.status_log;
    if (!Array.isArray(log) || log.length === 0) return;
    const last = clone(log[log.length - 1]);
    if (last && typeof last === 'object') last.id = `${last.id}-dup`;
    log.push(last);
  });
}

import { wrapState, clone } from './_helpers.mjs';

/**
 * 状态跑出枚举之外。
 *
 * 症状：订单状态里冒出一个谁都没定义过的 'PROCESSING'。
 * 怎么坏：把 orders 里每条 status 换成一个不在状态机里的词。
 * 怎么抓：subset {collection:'orders', path:'status', values:[五个合法状态]}。
 *         注意它和 field_equals 的分工：断「终态等于 PICKED」只能钉住一条路径上的
 *         一个点；断「所有行的状态都属于这五个值」说的是整个字段的值域。
 */
export const meta = {
  id: 'm-status-off-enum',
  title: '状态跑出枚举之外',
  layer: 'state',
  symptom: "status 出现状态机里没有的 'PROCESSING'",
  mechanism: '把所有 status 换成一个未定义的值',
  catch_hint: 'subset on status',
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state && state.orders;
    if (!Array.isArray(rows)) return;
    rows.forEach((r) => {
      if (r && r.status !== undefined) r.status = 'PROCESSING';
    });
  });
}

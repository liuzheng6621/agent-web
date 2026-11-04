import { wrapExecuteAfter } from './_helpers.mjs';

export const meta = {
  id: 'm-no-reject',
  title: '该拒的不拒',
  layer: 'execute',
  symptom: '状态机校验被注释掉了，非法迁移一律放行',
  mechanism: '把 outcome=rejected 的动作改写成 applied，伪造 payload',
  catch_hint: '只能靠负例步；终态断言在"反正也没变"的情况下是真空成立的',
};

export function wrap(adapter) {
  return wrapExecuteAfter(adapter, (action, res) => {
    if (res.outcome !== 'rejected') return null;
    const orderId = action.arguments?.orderId ?? action.bindings?.orderId ?? null;
    return { outcome: 'applied', payload: { orderId }, identity: res.identity };
  });
}

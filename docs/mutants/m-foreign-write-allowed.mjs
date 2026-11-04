import { wrapExecute } from './_helpers.mjs';

export const meta = {
  id: 'm-foreign-write-allowed',
  title: '越权写被放行',
  layer: 'execute',
  symptom: '归属校验漏了，第二个顾客能操作别人的单',
  mechanism: '把 as=customer2 的请求改成 as=customer 再执行',
  catch_hint: '只能靠负例步（expected_outcome=rejected）抓；终态断言看不见"谁做的"',
};

export function wrap(adapter) {
  return wrapExecute(adapter, (action) => {
    if (action.as !== 'customer2') return null;
    return { ...action, as: 'customer' };
  });
}

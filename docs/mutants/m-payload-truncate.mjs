export const meta = {
  id: 'm-payload-truncate',
  title: '列表少给你一行',
  layer: 'execute',
  symptom: '库里数据是全的，接口返回的列表却少一条；分页 total 说 5，翻完只有 4 条',
  mechanism: '执行成功后，把返回体里每个顶层数组砍掉最后一个元素——状态没坏，只有响应体坏了',
  catch_hint: '要看**返回体**的断言（payload），或者 pagination 的「各页之和 == total」；只看规范视图会全部漏掉',
  applies_to: { collections: ['orders'] },
};

import { clone } from './_helpers.mjs';

function truncate(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return value;
    return clone(value.slice(0, -1));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = truncate(v);
    return out;
  }
  return value;
}

export function wrap(adapter) {
  return {
    ...adapter,
    manifest: (...args) => adapter.manifest(...args),
    reset: (...args) => adapter.reset(...args),
    observe: (...args) => adapter.observe(...args),
    close: (...args) => adapter.close?.(...args),
    classify: (...args) => adapter.classify?.(...args),
    async execute(...args) {
      const r = await adapter.execute(...args);
      if (r && r.payload !== undefined) {
        const cut = truncate(r.payload);
        return cut === undefined ? r : { ...r, payload: cut };
      }
      return r;
    },
  };
}

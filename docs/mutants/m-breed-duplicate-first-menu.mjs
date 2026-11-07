/**
 * 由 agent-web breed 生成，勿手改（重跑即覆盖）。
 * 位置：menu    算子在 复制首条
 */

export const meta = {
  id: "m-breed-duplicate-first-menu",
  title: "menu 第一条被复制一份",
  layer: 'state',
  symptom: "menu 从 共 3 条 变成 多 1 条（首条重复）",
  mechanism: "返回前把第一个元素再 push 一遍",
  catch_hint: "一条 sorted 断言，或 count_delta 加首元素 field_equals；只断言数量抓不到",
  applies_to: { collections: ["menu"] },
  generated: true,
  breed_version: "agent-web/breed-1",
};

const getPath = (obj, dotted) => {
  let cur = obj;
  for (const seg of String(dotted).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg];
  }
  return cur;
};

const setPath = (obj, dotted, value) => {
  const segs = String(dotted).split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (cur[segs[i]] === null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
};

const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

export function wrap(adapter) {
  const inner = adapter;
  return {
    ...inner,
    async observe(runId, scopes) {
      const res = await inner.observe(runId, scopes);
      if (!res || !res.state) return res;
      const state = clone(res.state);
      const arr = state["menu"];
      if (!Array.isArray(arr) || arr.length === 0) return res;
      arr.push(clone(arr[0]));
      return { ...res, state };
    },
  };
}

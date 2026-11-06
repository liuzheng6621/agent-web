/**
 * 由 agent-web breed 生成，勿手改（重跑即覆盖）。
 * 位置：menu    算子在 丢头
 */

export const meta = {
  id: "m-breed-drop-first-menu",
  title: "menu 第一条凭空消失",
  layer: 'state',
  symptom: "menu 从 共 3 条 变成 少 1 条（丢头）",
  mechanism: "返回前把这个集合的第一个元素删掉",
  catch_hint: "一条 sorted 断言，或 count_delta 加首元素 field_equals；只断言数量抓不到",
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
      arr.shift();
      return { ...res, state };
    },
  };
}

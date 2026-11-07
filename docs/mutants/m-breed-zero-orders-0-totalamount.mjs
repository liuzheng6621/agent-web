/**
 * 由 agent-web breed 生成，勿手改（重跑即覆盖）。
 * 位置：orders[0].totalAmount    算子在 归零
 */

export const meta = {
  id: "m-breed-zero-orders-0-totalamount",
  title: "orders[0].totalAmount 数字变成 0",
  layer: 'state',
  symptom: "orders[0].totalAmount 从 122 变成 0",
  mechanism: "把这个数值置为 0",
  catch_hint: "一条 field_equals 断言 orders[0].totalAmount；只断言状态或数量抓不到",
  applies_to: { collections: ["orders"] },
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
      const entity = (state["orders"] ?? [])[0];
      if (!entity) return res;
      const current = getPath(entity, "totalAmount");
      if (typeof current !== "number") return res;
      const v = current;
      setPath(entity, "totalAmount", 0);
      return { ...res, state };
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { pagination, rowsOfPayload } from '../src/assert/pagination.mjs';

const ctxOf = (pages) => ({ trace: pages.map((rows) => ({ stateAfter: {}, payload: { orders: rows } })) });

/** 每页返回体里额外带上实现自己报的 total。 */
const ctxWithTotal = (pages, total, wrap = false) => ({
  trace: pages.map((rows) => ({
    stateAfter: {},
    payload: wrap ? { data: { orders: rows, total } } : { orders: rows, total },
  })),
});

test('分页：正常翻完三页判真', () => {
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2, 3], total: 5, pageSize: 2, ordered_by: 'id' }, ctxOf([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], [{ id: 5 }]]));
  assert.equal(r.status, 'true', r.message);
});

test('分页：跨页重复判假，并点出哪个键', () => {
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2, ordered_by: 'id' }, ctxOf([[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]]));
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'pagination_duplicate');
  assert.match(r.message, /id=2/);
  assert.match(r.message, /第 1 步和第 2 步/);
});

test('分页：同一页内重复也抓', () => {
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2, ordered_by: 'id' }, ctxOf([[{ id: 1 }, { id: 1 }], [{ id: 2 }, { id: 3 }]]));
  assert.equal(r.code, 'pagination_duplicate');
  assert.match(r.message, /第 1 步的返回里出现了两次/);
});

test('分页：非末页不满判假（边界丢行）', () => {
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2], total: 3, pageSize: 2 }, ctxOf([[{ id: 1 }], [{ id: 2 }]]));
  assert.equal(r.code, 'pagination_size');
});

test('分页：条数加起来不等于 total 判假', () => {
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2], total: 5, pageSize: 2 }, ctxOf([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }]]));
  assert.equal(r.code, 'pagination_total');
  assert.match(r.message, /只拿到 4 条/);
});

test('分页：行数全对、但实现自己报的 total 说谎，也要判假', () => {
  // 每页都满、拼起来正好 4 条，只有返回体里的 total 写着 900 ——
  // 只数行数的检查在这里全是绿的，是典型假绿。
  const r = pagination(
    { kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2 },
    ctxWithTotal([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }]], 900),
  );
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'pagination_total_reported');
  assert.match(r.message, /total 是 900/);
  assert.match(r.message, /案例声称 4/);
});

test('分页：报数说谎优先于丢行报告（先指出报数，不误报成丢行）', () => {
  const r = pagination(
    { kind: 'pagination', collection: 'orders', steps: [1, 2], total: 5, pageSize: 2 },
    ctxWithTotal([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }]], 5),
  );
  // 报数对得上，剩下的问题才是真的丢行
  assert.equal(r.code, 'pagination_total');
});

test('分页：{data:{total}} 包裹里的报数也能读到', () => {
  const ok = pagination(
    { kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2 },
    ctxWithTotal([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }]], 4, true),
  );
  assert.equal(ok.status, 'true', ok.message);
  const bad = pagination(
    { kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2 },
    ctxWithTotal([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }]], 7, true),
  );
  assert.equal(bad.code, 'pagination_total_reported');
});

test('分页：返回体没报 total 时跳过报数检查，不误判', () => {
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2 }, ctxOf([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }]]));
  assert.equal(r.status, 'true', r.message);
});

test('分页：total 不是数字（字符串/空）时不当作报数，跳过', () => {
  const ctx = { trace: [{ payload: { orders: [{ id: 1 }, { id: 2 }], total: '4' } }, { payload: { orders: [{ id: 3 }, { id: 4 }], total: null } }] };
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2 }, ctx);
  assert.equal(r.status, 'true', r.message);
});

test('分页：翻页乱序判假', () => {
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2], total: 4, pageSize: 2, ordered_by: 'id' }, ctxOf([[{ id: 2 }, { id: 1 }], [{ id: 3 }, { id: 4 }]]));
  assert.equal(r.code, 'pagination_order');
});

test('分页：步号越界或步不存在判 unknown，不判假', () => {
  const r1 = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 9], total: 2 }, ctxOf([[{ id: 1 }], [{ id: 2 }]]));
  assert.equal(r1.status, 'unknown');
  assert.equal(r1.code, 'missing_observation');
  const r2 = pagination({ kind: 'pagination', collection: 'orders', steps: [0, 1] }, ctxOf([[{ id: 1 }], [{ id: 2 }]]));
  assert.equal(r2.status, 'unknown');
  assert.equal(r2.code, 'invalid_case');
});

test('分页：返回体里没有这个集合判 unknown（适配器把结果放别处）', () => {
  const ctx = { trace: [{ payload: { rows: [{ id: 1 }, { id: 2 }] } }, { payload: { rows: [{ id: 3 }] } }] };
  const r = pagination({ kind: 'pagination', collection: 'orders', steps: [1, 2] }, ctx);
  assert.equal(r.status, 'unknown');
  assert.match(r.message, /没有 orders/);
});

test('分页：参数不合法判 invalid_case', () => {
  assert.equal(pagination({ kind: 'pagination', steps: [1] }, ctxOf([[{ id: 1 }]])).code, 'invalid_case');
  assert.equal(pagination({ kind: 'pagination', steps: [1, 2], total: -1 }, ctxOf([[{ id: 1 }], [{ id: 2 }]])).code, 'invalid_case');
  assert.equal(pagination({ kind: 'pagination', steps: [1, 2], pageSize: 0 }, ctxOf([[{ id: 1 }], [{ id: 2 }]])).code, 'invalid_case');
});

test('返回体取行：兼容裸数组、{orders}、{data:{orders}}', () => {
  assert.deepEqual(rowsOfPayload([{ id: 1 }, { id: 2 }], null), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(rowsOfPayload({ orders: [{ id: 3 }] }, 'orders'), [{ id: 3 }]);
  assert.deepEqual(rowsOfPayload({ data: { orders: [{ id: 4 }] } }, 'orders'), [{ id: 4 }]);
  assert.equal(rowsOfPayload({ orders: [{ id: 3 }] }, null), null);
  assert.equal(rowsOfPayload({ orders: [{ id: 3 }] }, 'nope'), null);
});

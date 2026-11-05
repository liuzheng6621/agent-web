import test from 'node:test';
import assert from 'node:assert/strict';
import { pagination, rowsOfPayload } from '../src/assert/pagination.mjs';

const ctxOf = (pages) => ({ trace: pages.map((rows) => ({ stateAfter: {}, payload: { orders: rows } })) });

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

import test from 'node:test';
import assert from 'node:assert/strict';
import { linkage } from '../src/assert/linkage.mjs';

const ctx = (final) => ({ initial: final, final, trace: [], missingScopes: [] });
const spec = {
  kind: 'linkage',
  from: { collection: 'orders' },
  to: { collection: 'status_log', on: { from_field: 'id', to_field: 'orderId' } },
  expect: { field: 'type', value: 'order.created' },
};

test('linkage：每一行都能在对侧对上就算成立', () => {
  const r = linkage(spec, ctx({
    orders: [{ id: 1 }, { id: 2 }],
    status_log: [{ orderId: 1, type: 'order.created' }, { orderId: 2, type: 'order.created' }],
  }));
  assert.equal(r.status, 'true');
});

test('linkage：对侧缺一条是**违反**，不是看不见', () => {
  const r = linkage(spec, ctx({ orders: [{ id: 1 }, { id: 2 }], status_log: [{ orderId: 1, type: 'order.created' }] }));
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'linkage_missing');
  assert.match(r.message, /orders\[1\]/);
});

test('linkage：对上但字段不对，报的是实际值与期望值', () => {
  const r = linkage(spec, ctx({ orders: [{ id: 1 }], status_log: [{ orderId: 1, type: 'order.picked' }] }));
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'linkage_violated');
  assert.match(r.message, /order\.picked/);
});

test('linkage：集合看不见 / 一行都没匹配上 / 参数不对，一律判不了', () => {
  assert.equal(linkage(spec, ctx({ orders: [{ id: 1 }] })).status, 'unknown');
  const empty = { ...spec, from: { collection: 'orders', where: [{ field: 'status', op: 'equals', value: 'CANCELED' }] } };
  assert.equal(linkage(empty, ctx({ orders: [{ id: 1, status: 'PENDING' }], status_log: [] })).status, 'unknown');
  assert.equal(linkage({ ...spec, to: { collection: 'status_log' } }, ctx({ orders: [], status_log: [] })).code, 'invalid_case');
});

test('linkage count：条数正好几条才算成立，多了少了都是违反', () => {
  const spec2 = { ...spec, expect: { count: 1 } };
  const one = ctx({ orders: [{ id: 1 }], status_log: [{ orderId: 1, type: 'order.created' }] });
  assert.equal(linkage(spec2, one).status, 'true');
  const two = ctx({ orders: [{ id: 1 }], status_log: [{ orderId: 1, type: 'order.created' }, { orderId: 1, type: 'order.created' }] });
  const r = linkage(spec2, two);
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'linkage_count_violated');
  assert.match(r.message, /有 2 条，必须正好 1 条/);
});

test('linkage count：at_least / at_most 与未知 op', () => {
  const two = ctx({ orders: [{ id: 1 }], status_log: [{ orderId: 1 }, { orderId: 1 }] });
  assert.equal(linkage({ ...spec, expect: { count: 2, count_op: 'at_least' } }, two).status, 'true');
  assert.equal(linkage({ ...spec, expect: { count: 1, count_op: 'at_most' } }, two).status, 'false');
  assert.equal(linkage({ ...spec, expect: { count: 1, count_op: 'nope' } }, two).code, 'invalid_case');
});

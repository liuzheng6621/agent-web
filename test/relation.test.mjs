import test from 'node:test';
import assert from 'node:assert/strict';
import { evalAssertion, validateAssertion, PHASE_MATRIX } from '../src/assert/index.mjs';
import { discoverRelations } from '../src/relations.mjs';
import { TRUE, FALSE, UNKNOWN } from '../src/three-valued.mjs';

const state = (orders) => ({ orders, menu: [], status_log: [] });

const order = (over = {}) => ({
  id: 1001,
  status: 'PICKED',
  totalAmount: 122,
  pickupNo: 1101,
  items: [
    { dishName: '拿铁', count: 2, unitPrice: 28, subTotal: 56 },
    { dishName: '美式', count: 3, unitPrice: 22, subTotal: 66 },
  ],
  ...over,
});

const ctx = (final) => ({ initial: state([]), final: state(final), trace: [], events: [], eventsComplete: true });

test('sum_equals：总额等于明细之和', () => {
  const a = { kind: 'relation', op: 'sum_equals', selector: { collection: 'orders', index: 0 }, items: 'items', of: 'subTotal', path: 'totalAmount' };
  assert.equal(evalAssertion(a, ctx([order()])).status, TRUE);

  const off = order({ totalAmount: 56 }); // 漏乘数量那类错的典型：只算了第一杯
  const r = evalAssertion(a, ctx([off]));
  assert.equal(r.status, FALSE);
  assert.equal(r.code, 'relation_violated');
  assert.match(r.message, /ΣsubTotal=122/);
});

test('product_equals：每条明细的小计等于单价乘数量', () => {
  const a = { kind: 'relation', op: 'product_equals', selector: { collection: 'orders', index: 0 }, items: 'items', left: 'count', right: 'unitPrice', path: 'subTotal' };
  assert.equal(evalAssertion(a, ctx([order()])).status, TRUE);

  const bad = order();
  bad.items[1].subTotal = 22; // 小计只算了一杯
  const r = evalAssertion(a, ctx([bad]));
  assert.equal(r.status, FALSE);
  assert.match(r.message, /items\[1\]/);
});

test('eq 与 sorted：字段恒等、取餐号单调不减', () => {
  const eq = { kind: 'relation', op: 'eq', selector: { collection: 'orders', index: 0 }, left: 'totalAmount', right: 'pickupNo' };
  assert.equal(evalAssertion(eq, ctx([order({ pickupNo: 122 })])).status, TRUE);
  assert.equal(evalAssertion(eq, ctx([order()])).status, FALSE);

  const sorted = { kind: 'relation', op: 'sorted', selector: { collection: 'orders' }, path: 'pickupNo' };
  assert.equal(evalAssertion(sorted, ctx([order(), order({ id: 1002, pickupNo: 1102 })])).status, TRUE);
  const r = evalAssertion(sorted, ctx([order({ pickupNo: 1102 }), order({ id: 1002, pickupNo: 1101 })]));
  assert.equal(r.status, FALSE);
  assert.match(r.message, /单调不减/);
});

test('关系式判不了的时候返回 unknown，不猜', () => {
  const a = { kind: 'relation', op: 'sum_equals', selector: { collection: 'orders', index: 0 }, items: 'items', of: 'subTotal', path: 'totalAmount' };
  assert.equal(evalAssertion(a, ctx([])).status, UNKNOWN, '没有实体');
  const broken = order({ totalAmount: '一百二十二' });
  assert.equal(evalAssertion(a, ctx([broken])).status, UNKNOWN, '总额不是数字');

  const sorted = { kind: 'relation', op: 'sorted', selector: { collection: 'orders' }, path: 'pickupNo' };
  assert.equal(evalAssertion(sorted, ctx([order({ pickupNo: 'a' }), order({ pickupNo: 1 })])).status, UNKNOWN, '类型不一致无法比较');
});

test('关系式只允许在终态求值', () => {
  assert.deepEqual(PHASE_MATRIX.relation.allowed, ['final']);
  const bad = { kind: 'relation', op: 'sorted', selector: { collection: 'orders' }, path: 'pickupNo', phase: 'trace' };
  const errs = validateAssertion(bad);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /只能在 final 求值/);
});

test('格式校验：缺参数的关系式被拒收', () => {
  assert.deepEqual(validateAssertion({ kind: 'relation', op: 'eq', selector: { collection: 'orders', index: 0 }, left: 'a' }).length, 1);
  // items / of / path 三个都缺，应当报三条
  assert.deepEqual(validateAssertion({ kind: 'relation', op: 'sum_equals', selector: { collection: 'orders', index: 0 } }).length, 3);
  assert.deepEqual(validateAssertion({ kind: 'relation', op: 'nope', selector: { collection: 'orders' } }).length, 1);
});

test('发现器：多明细多数量时判为结构性关系', () => {
  const found = discoverRelations({ initial: state([]), final: state([order()]) });
  const sum = found.find((x) => x.assertion.op === 'sum_equals');
  const prod = found.find((x) => x.assertion.op === 'product_equals');
  assert.ok(sum, '应当发现总额等于明细之和');
  assert.ok(prod, '应当发现小计等于单价乘数量');
  assert.equal(sum.confidence, 'structural');
  assert.equal(prod.confidence, 'structural');
});

test('发现器：一条明细且数量为 1 时判为巧合，并说明为什么', () => {
  const single = order({ totalAmount: 28, items: [{ dishName: '拿铁', count: 1, unitPrice: 28, subTotal: 28 }] });
  const found = discoverRelations({ initial: state([]), final: state([single]) });
  const prod = found.find((x) => x.assertion.op === 'product_equals');
  assert.ok(prod, '关系本身成立，应当被发现');
  assert.equal(prod.confidence, 'coincidence', '数量为 1 时它区分不出「漏乘数量」');
});

test('发现器不会提议不成立的关系', () => {
  const broken = order({ totalAmount: 999 });
  const found = discoverRelations({ initial: state([]), final: state([broken]) });
  assert.equal(found.find((x) => x.assertion.op === 'sum_equals'), undefined);
});

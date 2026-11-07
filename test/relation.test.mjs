import test from 'node:test';
import assert from 'node:assert/strict';
import { evalAssertion, validateAssertion, PHASE_MATRIX } from '../src/assert/index.mjs';
import { discoverRelations } from '../src/relations.mjs';
import { relation } from '../src/assert/relation.mjs';
import { TRUE, FALSE, UNKNOWN } from '../src/three-valued.mjs';

const state = (orders) => ({ orders, menu: [], status_log: [] });

const order = (over = {}) => ({
  id: 1001,
  status: 'PICKED',
  totalAmount: 122,
  pickupNo: 1101,
  items: [
    { dishName: '拿铁', count: 2, unitPrice: 28, subTotal: 56 },
    { dishName: '美式咖啡', count: 3, unitPrice: 22, subTotal: 66 },
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

test('一把尺子：0.1+0.2 的账不能因为浮点判假红（三个算子同一个 close）', () => {
  const floaty = { final: { transactions: [{ entries: [
    { direction: 'debit', amount: 0.1 }, { direction: 'debit', amount: 0.2 },
    { direction: 'credit', amount: 0.3 },
  ] }] } };
  const spec = {
    selector: { collection: 'transactions' },
    op: 'sum_by_equals', leaf: 'entries', field: 'amount', group_field: 'direction', left: 'debit', right: 'credit',
  };
  // 旧代码在这里用 === ：0.1+0.2 与 0.3 差 5.6e-17，合法账被记成 relation_violated
  assert.equal(relation(spec, floaty).status, 'true');

  const sumEquals = {
    kind: 'relation', op: 'sum_equals', selector: { collection: 'orders', index: 0 },
    items: 'items', of: 'subTotal', path: 'totalAmount',
  };
  const order = { id: 1, status: 'PICKED', totalAmount: 0.3, items: [
    { dishName: 'a', count: 1, unitPrice: 0.1, subTotal: 0.1 },
    { dishName: 'b', count: 1, unitPrice: 0.2, subTotal: 0.2 },
  ] };
  assert.equal(evalAssertion(sumEquals, { final: { orders: [order], menu: [], status_log: [] } }).status, TRUE);
});

test('大金额也守得住：容差随量级走，1e9 量级的浮点误差不判假，差 100 元照判假', () => {
  const spec = {
    selector: { collection: 'transactions' },
    op: 'sum_by_equals', leaf: 'entries', field: 'amount', group_field: 'direction', left: 'debit', right: 'credit',
  };
  // 7 笔 (1e9/7) 加起来与 1e9 差 2.4e-7 —— float64 在这个量级的最小间隔就比 1e-9 大
  const legit = { final: { transactions: [{ entries: Array.from({ length: 7 }, () => ({ direction: 'debit', amount: 1e9 / 7 })).concat([{ direction: 'credit', amount: 1e9 }]) }] } };
  assert.equal(relation(spec, legit).status, 'true');
  // 真·不平（差 100 元）：1e9 量级下也必须红
  const off = { final: { transactions: [{ entries: [
    { direction: 'debit', amount: 1e9 }, { direction: 'debit', amount: 1e9 },
    { direction: 'credit', amount: 2e9 - 100 },
  ] }] } };
  const r = relation(spec, off);
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'relation_violated');
});

test('sum_equals 同样随量级走：七笔 1e9/7 凑成 1e9 是对的，不是 violation', () => {
  const unit = 1e9 / 7;
  const a = {
    kind: 'relation', op: 'sum_equals', selector: { collection: 'orders', index: 0 },
    items: 'items', of: 'subTotal', path: 'totalAmount',
  };
  const big = {
    id: 1, status: 'PICKED', totalAmount: 1e9,
    items: Array.from({ length: 7 }, (_, i) => ({ dishName: `d${i}`, count: 1, unitPrice: unit, subTotal: unit })),
  };
  // 旧尺子（绝对 1e-9）：和与总额差 2.4e-7，比 1e-9 大，假红
  assert.equal(evalAssertion(a, { final: { orders: [big], menu: [], status_log: [] } }).status, TRUE);
});

test('sum_by_equals：借贷必须相等，多一条贷方就红', () => {
  const spec = {
    selector: { collection: 'transactions' },
    op: 'sum_by_equals', leaf: 'entries', field: 'amount', group_field: 'direction', left: 'debit', right: 'credit',
  };
  const good = { final: { transactions: [{ entries: [{ direction: 'debit', amount: 100 }, { direction: 'credit', amount: 100 }] }] } };
  assert.equal(relation(spec, good).status, 'true');
  const bad = { final: { transactions: [{ entries: [{ direction: 'debit', amount: 100 }, { direction: 'credit', amount: 100 }, { direction: 'credit', amount: 100 }] }] } };
  const r = relation(spec, bad);
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'relation_violated');
  assert.match(r.message, /debit 合计 100 ≠ credit 合计 200/);
});

test('sum_by_equals：缺参数 / 找不到对应行 都是 unknown，不判假', () => {
  const ctx = { final: { transactions: [{ entries: [{ direction: 'debit', amount: 1 }] }] } };
  assert.equal(relation({ selector: { collection: 'transactions' }, op: 'sum_by_equals' }, ctx).code, 'invalid_case');
  const spec = { selector: { collection: 'transactions' }, op: 'sum_by_equals', leaf: 'entries', field: 'amount', group_field: 'direction', left: 'debit', right: 'credit' };
  // 只有借方、没有贷方：**这就是不平**，要判假而不是「看不见」
  const oneSide = { final: { transactions: [{ entries: [{ direction: 'debit', amount: 1 }] }] } };
  assert.equal(relation(spec, oneSide).code, 'relation_violated');
  // 一条方向都没匹配上，才算看不见
  const none = { final: { transactions: [{ entries: [{ direction: 'memo', amount: 1 }] }] } };
  assert.equal(relation(spec, none).code, 'missing_observation');
});

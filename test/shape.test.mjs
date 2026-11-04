import test from 'node:test';
import assert from 'node:assert/strict';

import { KINDS, validateAssertion, evalAssertion } from '../src/assert/index.mjs';
import { SHAPE_KINDS, SHAPE_TYPES } from '../src/assert/shape.mjs';
import { TRUE, FALSE, UNKNOWN } from '../src/three-valued.mjs';

const ctxWith = (state) => ({ final: state, initial: state, trace: [], events: [], eventsComplete: true });

const ORDERS = {
  orders: [
    { id: 1, totalAmount: 56, status: 'PENDING', createTime: 10 },
    { id: 2, totalAmount: 122, status: 'PICKED', createTime: 20 },
  ],
};

const sel = { collection: 'orders' };

test('四种形状断言都进了 KINDS，并且只在终态求值', async () => {
  for (const k of SHAPE_KINDS) {
    assert.ok(KINDS.includes(k), `${k} 不在 KINDS 里`);
    const errs = validateAssertion({ kind: k, selector: sel, path: 'id', type: 'number', values: [1] });
    const phaseErr = errs.find((e) => e.includes('只能在'));
    assert.ok(!phaseErr, `${k} 相位校验异常：${phaseErr}`);
  }
});

test('unique：重复的值判假，并指出是哪两行', async () => {
  const ok = evalAssertion({ kind: 'unique', selector: sel, path: 'id' }, ctxWith(ORDERS));
  assert.equal(ok.status, TRUE);

  const dup = evalAssertion(
    { kind: 'unique', selector: sel, path: 'id' },
    ctxWith({ orders: [{ id: 7 }, { id: 7 }] }),
  );
  assert.equal(dup.status, FALSE);
  assert.equal(dup.code, 'shape_violated');
  assert.match(dup.message, /第 0 行与第 1 行/);
});

test('unique：类型不同不算重复（1 与 "1" 是两回事）', async () => {
  const r = evalAssertion({ kind: 'unique', selector: sel, path: 'id' }, ctxWith({ orders: [{ id: 1 }, { id: '1' }] }));
  assert.equal(r.status, TRUE);
});

test('type_of：数字被序列化成字符串时判假，类型报准', async () => {
  const ok = evalAssertion({ kind: 'type_of', selector: sel, path: 'totalAmount', type: 'number' }, ctxWith(ORDERS));
  assert.equal(ok.status, TRUE);

  const bad = evalAssertion(
    { kind: 'type_of', selector: sel, path: 'totalAmount', type: 'number' },
    ctxWith({ orders: [{ totalAmount: 56 }, { totalAmount: '122' }] }),
  );
  assert.equal(bad.status, FALSE);
  assert.match(bad.message, /实际是 string/);
});

test('type_of：整数满足 number；null 一律放过（缺字段与 null 跨实现分不清）', async () => {
  const int = evalAssertion({ kind: 'type_of', selector: sel, path: 'id', type: 'number' }, ctxWith(ORDERS));
  assert.equal(int.status, TRUE);

  const nul = evalAssertion({ kind: 'type_of', selector: sel, path: 'totalAmount', type: 'number' }, ctxWith({ orders: [{ totalAmount: null }] }));
  assert.equal(nul.status, TRUE);
});

test('type_of：未知类型名判 invalid_case，而不是猜', async () => {
  const r = evalAssertion({ kind: 'type_of', selector: sel, path: 'id', type: 'money' }, ctxWith(ORDERS));
  assert.equal(r.status, UNKNOWN);
  assert.equal(r.code, 'invalid_case');
});

test('subset：跑出值域判假，报出那个越界的值', async () => {
  const RANGE = ['PENDING', 'MAKING', 'READY', 'PICKED', 'CANCELED'];
  const ok = evalAssertion({ kind: 'subset', selector: sel, path: 'status', values: RANGE }, ctxWith(ORDERS));
  assert.equal(ok.status, TRUE);

  const bad = evalAssertion(
    { kind: 'subset', selector: sel, path: 'status', values: RANGE },
    ctxWith({ orders: [{ status: 'PENDING' }, { status: 'PROCESSING' }] }),
  );
  assert.equal(bad.status, FALSE);
  assert.match(bad.message, /PROCESSING/);
});

test('sorted_by：逆序判假并指出相邻两行；相等不算违反', async () => {
  const asc = evalAssertion({ kind: 'sorted_by', selector: sel, path: 'createTime', order: 'asc' }, ctxWith(ORDERS));
  assert.equal(asc.status, TRUE);

  const desc = evalAssertion({ kind: 'sorted_by', selector: sel, path: 'createTime', order: 'desc' }, ctxWith(ORDERS));
  assert.equal(desc.status, FALSE);
  assert.match(desc.message, /第 0 行 10，第 1 行 20/);

  const eq = evalAssertion(
    { kind: 'sorted_by', selector: sel, path: 'createTime', order: 'asc' },
    ctxWith({ orders: [{ createTime: 5 }, { createTime: 5 }] }),
  );
  assert.equal(eq.status, TRUE, '相等不该判违反：稳定排序会保留相等元素');
});

test('sorted_by：不足两行时判 unknown —— 一行没有顺序可言', async () => {
  const r = evalAssertion({ kind: 'sorted_by', selector: sel, path: 'createTime' }, ctxWith({ orders: [{ createTime: 1 }] }));
  assert.equal(r.status, UNKNOWN);
  assert.equal(r.code, 'missing_observation');
});

test('四种都遵守「缺字段判 unknown 不判假」', async () => {
  const state = { orders: [{ id: 1 }] };
  for (const a of [
    { kind: 'unique', selector: sel, path: 'nope' },
    { kind: 'type_of', selector: sel, path: 'nope', type: 'string' },
    { kind: 'subset', selector: sel, path: 'nope', values: ['x'] },
  ]) {
    const r = evalAssertion(a, ctxWith(state));
    assert.equal(r.status, UNKNOWN, `${a.kind} 应该判 unknown`);
    assert.equal(r.code, 'missing_observation');
  }
});

test('集合不存在时四种都判 unknown / missing_observation', async () => {
  const state = { menu: [] };
  for (const a of [
    { kind: 'unique', selector: sel, path: 'id' },
    { kind: 'type_of', selector: sel, path: 'id', type: 'number' },
    { kind: 'subset', selector: sel, path: 'status', values: ['x'] },
    { kind: 'sorted_by', selector: sel, path: 'createTime' },
  ]) {
    const r = evalAssertion(a, ctxWith(state));
    assert.equal(r.status, UNKNOWN, `${a.kind} 对缺失集合应判 unknown`);
  }
});

test('格式校验：缺 path / 缺 type / 空 values 都拒收', async () => {
  assert.ok(validateAssertion({ kind: 'unique', selector: sel }).some((e) => e.includes('.path 必填')));
  assert.ok(validateAssertion({ kind: 'type_of', selector: sel, path: 'x' }).some((e) => e.includes('.type 不在')));
  assert.ok(validateAssertion({ kind: 'subset', selector: sel, path: 'x', values: [] }).some((e) => e.includes('values')));
  assert.ok(validateAssertion({ kind: 'sorted_by', selector: sel, path: 'x', order: 'up' }).some((e) => e.includes('asc/desc')));
});

test('SHAPE_TYPES 覆盖 JSON 的七种类型', async () => {
  assert.deepEqual([...SHAPE_TYPES].sort(), ['array', 'boolean', 'integer', 'null', 'number', 'object', 'string']);
});

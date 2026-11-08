import { test } from 'node:test';
import assert from 'node:assert/strict';
import { precedence, PRECEDENCE_VERSION } from '../src/assert/precedence.mjs';
import { KINDS, PHASE_MATRIX, validateAssertion, phaseOf } from '../src/assert/index.mjs';

const ctx = (rows) => ({ final: { status_log: rows } });
const row = (type) => ({ type, from: 'PENDING', to: type.replace('order.', '').toUpperCase(), at: '2026-01-01T00:00:0Z' });
const A = (...types) => ({ kind: 'precedence', expect: types.map((t) => ({ type: t })) });

test('注册表：第 21 种，相位固定 final', () => {
  assert.equal(KINDS.length, 21, '相对序上线后是 21 种');
  assert.ok(KINDS.includes('precedence'));
  assert.deepEqual(PHASE_MATRIX.precedence.allowed, ['final']);
  assert.equal(phaseOf({ kind: 'precedence' }), 'final');
  assert.equal(PRECEDENCE_VERSION, 'agent-web/precedence-1');
});

test('校验：expect 必填且每项要有 type 或 field+value', () => {
  assert.ok(validateAssertion({ kind: 'precedence', expect: [] }).length > 0, '空 expect 要报');
  assert.ok(validateAssertion({ kind: 'precedence' }).length > 0, '缺 expect 要报');
  assert.ok(validateAssertion({ kind: 'precedence', expect: [{}] }).length > 0, '空对象要报');
  assert.ok(validateAssertion({ kind: 'precedence', expect: [{ field: 'x' }] }).length > 0, '只有 field 没有 value 要报');
  assert.deepEqual(validateAssertion({ kind: 'precedence', expect: [{ type: 'a' }] }), []);
  assert.deepEqual(validateAssertion({ kind: 'precedence', expect: [{ field: 'x', value: 1 }] }), []);
  assert.ok(validateAssertion({ kind: 'precedence', expect: [{ type: 'a' }], collection: 3 }).length > 0, 'collection 要字符串');
});

test('按序命中（允许中间夹行）→ true', () => {
  const rows = [row('order.created'), row('order.noise'), row('order.making'), row('order.noise2'), row('order.ready'), row('order.picked')];
  const r = precedence(A('order.making', 'order.ready', 'order.picked'), ctx(rows));
  assert.equal(r.status, 'true');
  assert.equal(r.code, 'ok');
});

test('被跳过：流水里根本没有 ready → precedence_missing', () => {
  const rows = [row('order.created'), row('order.making'), row('order.picked')];
  const r = precedence(A('order.making', 'order.ready', 'order.picked'), ctx(rows));
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'precedence_missing');
  assert.match(r.message, /被跳过/);
});

test('顺序反了：ready 出现在 making 前面 → precedence_inverted', () => {
  const rows = [row('order.created'), row('order.ready'), row('order.making'), row('order.picked')];
  const r = precedence(A('order.making', 'order.ready', 'order.picked'), ctx(rows));
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'precedence_inverted');
  assert.match(r.message, /相对顺序反了/);
});

test('自定 collection：找不到集合 → unknown/missing_observation', () => {
  const r = precedence({ kind: 'precedence', collection: 'ledger_entries', expect: [{ type: 'x' }] }, ctx([]));
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_observation');
});

test('无终态视图 → unknown', () => {
  assert.equal(precedence(A('a'), { final: null }).status, 'unknown');
  assert.equal(precedence(A('a'), undefined).status, 'unknown');
});

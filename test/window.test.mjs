import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssertion, evalAssertion } from '../src/assert/index.mjs';
import { TRUE, FALSE, UNKNOWN } from '../src/three-valued.mjs';

/**
 * 手工造 ctx：三种状态（起点 / 中途 / 终点），菜单只读、流水只在最后一步多一行。
 * 这样才能把「中途坏、结尾修好」精确地摆出来，不依赖任何适配器。
 */
function ctxWith({ menuMid, logMid, logEnd }) {
  const initial = { menu: [{ name: '拿铁', price: 28 }], status_log: [{ id: 1, type: 'order.created' }] };
  const mid = {
    menu: [{ name: '拿铁', price: menuMid }],
    status_log: logMid,
  };
  const final = { menu: [{ name: '拿铁', price: 28 }], status_log: logEnd };
  return {
    initial,
    final,
    trace: [{ stateAfter: mid }, { stateAfter: final }],
    events: [],
    eventsComplete: true,
    eventsVocabulary: [],
    missingScopes: [],
  };
}

// 终态与起点相同：净变化为零，这是「整体断言看不见泄漏」的前提。
const endLog = [{ id: 1, type: 'order.created' }];

test('window：同区间的净变化为零就判真', () => {
  const ctx = ctxWith({ menuMid: 28, logMid: endLog.slice(0, 1), logEnd: endLog });
  const a = { kind: 'window', from_step: 1, to_step: 2, of: { kind: 'unchanged', scopes: ['menu'] } };
  assert.deepEqual(validateAssertion(a, 'a'), []);
  assert.equal(evalAssertion(a, ctx).status, TRUE);
});

test('window：只在中间那一步出现的泄漏判假 —— 整体 unchanged 看不见它', () => {
  const leaked = [{ id: 1, type: 'order.created' }, { id: 99, type: 'order.leaked' }];
  const ctx = ctxWith({ menuMid: 28, logMid: leaked, logEnd: endLog });
  const whole = evalAssertion({ kind: 'unchanged', scopes: ['status_log'] }, ctx);
  assert.equal(whole.status, TRUE, '首尾相比净变化为零，整体断言看不出泄漏');
  const win = evalAssertion(
    { kind: 'window', from_step: 1, to_step: 2, of: { kind: 'unchanged', scopes: ['status_log'] } },
    ctx,
  );
  assert.equal(win.status, FALSE);
  assert.equal(win.at_step, 1);
});

test('window：区间越界或方向反了都是 invalid_case，不许猜', () => {
  const ctx = ctxWith({ menuMid: 28, logMid: endLog, logEnd: endLog });
  for (const [from, to] of [[1, 9], [2, 1], [-1, 1]]) {
    const r = evalAssertion({ kind: 'window', from_step: from, to_step: to, of: { kind: 'unchanged', scopes: ['menu'] } }, ctx);
    assert.equal(r.status, UNKNOWN, `${from}->${to} 应判 unknown`);
    assert.equal(r.code, 'invalid_case');
  }
});

test('window：内层只允许四种 kind，别的直接在校验期拒收', () => {
  const errs = validateAssertion({ kind: 'window', from_step: 0, to_step: 1, of: { kind: 'status_transition', selector: { collection: 'orders' }, path: 'status' } }, 'a');
  assert.ok(errs.some((e) => e.includes('of 只能是')), errs.join('; '));
});

test('window：内层断言缺失时校验期就报，不等到求值', () => {
  const errs = validateAssertion({ kind: 'window', from_step: 0, to_step: 1 }, 'a');
  assert.ok(errs.some((e) => e.includes('需要一个内层断言 of')), errs.join('; '));
});

test('every_step：中途抖一下又改回来判假，并指出第几步', () => {
  const ctx = ctxWith({ menuMid: 29, logMid: endLog.slice(0, 1), logEnd: endLog });
  assert.equal(evalAssertion({ kind: 'unchanged', scopes: ['menu'] }, ctx).status, TRUE, '首尾相同');
  const r = evalAssertion({ kind: 'every_step', of: { kind: 'unchanged', scopes: ['menu'] } }, ctx);
  assert.equal(r.status, FALSE);
  assert.equal(r.at_step, 1);
});

test('every_step：每一步都成立才判真', () => {
  const ctx = ctxWith({ menuMid: 28, logMid: endLog.slice(0, 1), logEnd: endLog });
  assert.equal(evalAssertion({ kind: 'every_step', of: { kind: 'unchanged', scopes: ['menu'] } }, ctx).status, TRUE);
});

test('every_step：没有 trace 就判 unknown，不当作通过', () => {
  const ctx = { ...ctxWith({ menuMid: 28, logMid: [], logEnd: endLog }), trace: [] };
  const r = evalAssertion({ kind: 'every_step', of: { kind: 'unchanged', scopes: ['menu'] } }, ctx);
  assert.equal(r.status, UNKNOWN);
  assert.equal(r.code, 'missing_observation');
});

test('两种时序断言的相位只能是 trace —— 写成 final 等于把窗口丢掉', () => {
  const errs = validateAssertion({ kind: 'every_step', phase: 'final', of: { kind: 'unchanged', scopes: ['menu'] } }, 'a');
  assert.ok(errs.length > 0, '应当拒绝把 every_step 的相位改成 final');
});

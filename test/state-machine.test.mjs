import test from 'node:test';
import assert from 'node:assert/strict';
import { state_machine } from '../src/assert/state_machine.mjs';
import { validateAssertion, KINDS, PHASE_MATRIX, phaseOf } from '../src/assert/index.mjs';

const GOOD = { from: 'PENDING', to: 'MAKING' };
const DECL = {
  states: ['PENDING', 'MAKING', 'READY', 'PICKED', 'CANCELED'],
  transitions: [
    ['PENDING', 'MAKING'],
    ['MAKING', 'READY'],
    ['READY', 'PICKED'],
    ['PENDING', 'CANCELED'],
  ],
};

function snapCtx(statuses) {
  return { trace: statuses.map((s) => ({ stateAfter: { orders: [{ status: s }] } })) };
}
function rowsCtx(log) {
  return { final: { status_log: log }, trace: [] };
}

test('快照序列：只走声明内的边 → 真', () => {
  const r = state_machine({ ...DECL, selector: { collection: 'orders' } }, snapCtx(['PENDING', 'MAKING', 'READY', 'PICKED']));
  assert.equal(r.status, 'true');
  assert.match(r.message, /全部迁移都在声明内/);
});

test('快照序列：走了未声明的边 → 假，并点名哪条边', () => {
  const r = state_machine({ ...DECL, selector: { collection: 'orders' } }, snapCtx(['PENDING', 'PICKED']));
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'illegal_transition');
  assert.match(r.message, /PENDING=>PICKED/);
  assert.deepEqual(r.illegal, ['PENDING=>PICKED']);
});

test('没声明 transitions → unknown，不默默通过', () => {
  const r = state_machine({ selector: { collection: 'orders' } }, snapCtx(['PENDING']));
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'not_declared');
});

test('观测到未声明的状态 → unknown，不判假（那是声明漏了态）', () => {
  const r = state_machine(
    { ...DECL, selector: { collection: 'orders' } },
    snapCtx(['PENDING', 'REFUNDING']),
  );
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'unknown_state');
  assert.match(r.message, /REFUNDING/);
});

test('取不到序列 → unknown', () => {
  const r = state_machine({ ...DECL, selector: { collection: 'orders' } }, { trace: [] });
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_observation');
});

test('walk=rows：把流水自己当序列，末尾多一条边就判假', () => {
  const log = [
    { from: 'PENDING', to: 'MAKING' },
    { from: 'MAKING', to: 'READY' },
    { from: 'READY', to: 'PICKED' },
    { from: 'PICKED', to: 'MAKING' },
  ];
  const r = state_machine({ ...DECL, walk: 'rows', selector: { collection: 'status_log' }, path: 'to' }, rowsCtx(log));
  assert.equal(r.status, 'false');
  assert.match(r.message, /PICKED=>MAKING/);
});

test('walk=rows：只在第一行看是抓不到的（证明 walk 参数不是装饰）', () => {
  const log = [
    { from: 'PENDING', to: 'MAKING' },
    { from: 'MAKING', to: 'READY' },
    { from: 'READY', to: 'PICKED' },
    { from: 'PICKED', to: 'MAKING' },
  ];
  const r = state_machine({ ...DECL, selector: { collection: 'orders' }, path: 'status' }, snapCtx(['PENDING']));
  assert.equal(r.status, 'true', '只看第一个快照当然看不出末尾那条边');
});

test('walk=rows：终态没有那个集合 → unknown', () => {
  const r = state_machine({ ...DECL, walk: 'rows', selector: { collection: 'status_log' } }, { final: {}, trace: [] });
  assert.equal(r.status, 'unknown');
});

test('校验：transitions 必须是 [from,to] 二元组', () => {
  assert.equal(validateAssertion({ kind: 'state_machine', transitions: [['A', 'B']] }).length, 0);
  const errs = validateAssertion({ kind: 'state_machine', transitions: [['A']] });
  assert.ok(errs.some((e) => e.includes('必须是 [from, to]')));
  const errs2 = validateAssertion({ kind: 'state_machine' });
  assert.ok(errs2.some((e) => e.includes('没声明就没约束')));
});

test('校验：states 给了就必须是非空字符串数组', () => {
  const errs = validateAssertion({ kind: 'state_machine', transitions: [['A', 'B']], states: [] });
  assert.ok(errs.some((e) => e.includes('非空数组')));
  const errs2 = validateAssertion({ kind: 'state_machine', transitions: [['A', 'B']], states: [1] });
  assert.ok(errs2.some((e) => e.includes('必须是字符串')));
});

test('注册表：第 19 种，相位固定 trace', () => {
  assert.equal(KINDS.length, 20);
  assert.ok(KINDS.includes('state_machine'));
  assert.deepEqual(PHASE_MATRIX.state_machine.allowed, ['trace']);
  assert.equal(phaseOf({ kind: 'state_machine' }), 'trace');
});

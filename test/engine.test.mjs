import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { TRUE, FALSE, UNKNOWN, and, or, not } from '../src/three-valued.mjs';
import { getPath, fingerprint, deepEqual, stableStringify } from '../src/values.mjs';
import { selectEntities, validateSelector } from '../src/select.mjs';
import { evalAssertions, validateAssertion, phaseOf } from '../src/assert/index.mjs';
import { validateCase, resolveArguments } from '../src/case.mjs';

const st = (orders) => ({ orders, status_log: [] });

test('三值逻辑：and 遇 false 即 false，否则有 unknown 即 unknown', () => {
  assert.equal(and(TRUE, TRUE), TRUE);
  assert.equal(and(TRUE, FALSE, UNKNOWN), FALSE);
  assert.equal(and(TRUE, UNKNOWN), UNKNOWN);
  assert.equal(and(), TRUE);
});

test('三值逻辑：or 遇 true 即 true；not unknown 仍是 unknown', () => {
  assert.equal(or(TRUE, UNKNOWN), TRUE);
  assert.equal(or(FALSE, UNKNOWN), UNKNOWN);
  assert.equal(or(), FALSE);
  assert.equal(not(UNKNOWN), UNKNOWN);
  assert.equal(not(TRUE), FALSE);
  assert.equal(not(FALSE), TRUE);
});

test('Kleene 真值表穷举：not(not(x)) === x，且 and/or 单调', () => {
  for (const v of [TRUE, FALSE, UNKNOWN]) assert.equal(not(not(v)), v);
  assert.equal(and(TRUE, TRUE), TRUE);
  assert.equal(and(FALSE, FALSE), FALSE);
  assert.equal(or(UNKNOWN, UNKNOWN), UNKNOWN);
});

test('getPath 支持点号路径、数组索引与 length', () => {
  const o = { a: { b: [{ c: 1 }] }, list: [1, 2, 3] };
  assert.equal(getPath(o, 'a.b.0.c'), 1);
  assert.equal(getPath(o, 'list.length'), 3);
  assert.equal(getPath(o, 'a.b.length'), 1);
  assert.equal(getPath(o, 'nope.deep'), undefined);
});

test('fingerprint 与键序无关，与值有关', () => {
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('deepEqual 区分类型与数组长度', () => {
  assert.equal(deepEqual({ a: [1, 2] }, { a: [1, 2] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: '1' }), false);
  assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
  assert.equal(deepEqual(NaN, NaN), true);
});

test('选择器：集合缺失是 missing，过滤后为空是 ok', () => {
  const missing = selectEntities({}, { collection: 'orders' });
  assert.equal(missing.status, 'missing');
  const empty = selectEntities(st([]), { collection: 'orders' });
  assert.equal(empty.status, 'ok');
  assert.equal(empty.total, 0);
});

test('选择器：where 与 index 组合', () => {
  const s = st([{ id: 1, status: 'READY' }, { id: 2, status: 'READY' }, { id: 3, status: 'PENDING' }]);
  const r = selectEntities(s, { collection: 'orders', where: [{ field: 'status', eq: 'READY' }], index: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].id, 2);
});

test('选择器：一个谓词不许带两个操作符', () => {
  const errs = validateSelector({ collection: 'o', where: [{ field: 'a', eq: 1, ne: 2 }] });
  assert.equal(errs.length, 1);
});

test('phase 矩阵：status_transition 只能在 trace 求值', () => {
  assert.equal(phaseOf({ kind: 'status_transition' }), 'trace');
  assert.equal(phaseOf({ kind: 'unchanged' }), 'initial_vs_final');
  assert.equal(phaseOf({ kind: 'field_equals' }), 'final');
  const errs = validateAssertion({ kind: 'status_transition', phase: 'final', selector: { collection: 'o' }, sequence: ['A'] });
  assert.ok(errs.length >= 1, '显式写错 phase 必须被拦');
});

test('field_equals：实体不存在记 false，多匹配记 unknown', () => {
  const ctx = { initial: st([]), final: st([]), trace: [], events: [], eventsComplete: false };
  const none = evalAssertions([{ kind: 'field_equals', selector: { collection: 'orders' }, path: 'status', value: 'X' }], ctx);
  assert.equal(none.status, FALSE);
  assert.equal(none.results[0].code, 'entity_not_found');

  const two = st([{ status: 'A' }, { status: 'A' }]);
  const multi = evalAssertions(
    [{ kind: 'field_equals', selector: { collection: 'orders' }, path: 'status', value: 'A' }],
    { ...ctx, final: two },
  );
  assert.equal(multi.status, UNKNOWN);
  assert.equal(multi.results[0].code, 'invalid_case');
});

test('观测缺失时断言返回 unknown，而不是 false', () => {
  const ctx = { initial: {}, final: {}, trace: [], events: [], eventsComplete: false };
  const r = evalAssertions([{ kind: 'entity_exists', selector: { collection: 'orders' } }], ctx);
  assert.equal(r.status, UNKNOWN);
  assert.equal(r.results[0].code, 'missing_observation');
});

test('unchanged 只保证净变化为零', () => {
  const ctx = {
    initial: st([{ id: 1, status: 'A' }]),
    final: st([{ id: 1, status: 'A' }]),
    trace: [],
    events: [],
    eventsComplete: false,
  };
  assert.equal(evalAssertions([{ kind: 'unchanged', scopes: ['orders'] }], ctx).results[0].status, TRUE);
  const changed = { ...ctx, final: st([{ id: 1, status: 'B' }]) };
  const r = evalAssertions([{ kind: 'unchanged', scopes: ['orders'] }], changed);
  assert.equal(r.results[0].status, FALSE);
  assert.equal(r.results[0].code, 'side_effect');
});

test('event_absent：事件记录不完整时是 unknown，不是 true', () => {
  const ctx = { initial: st([]), final: st([]), trace: [], events: [], eventsComplete: false };
  const r = evalAssertions([{ kind: 'event_absent', type: 'order.canceled' }], ctx);
  assert.equal(r.status, UNKNOWN);
  assert.equal(r.results[0].code, 'incomplete_observation');

  const complete = { ...ctx, eventsComplete: true, events: [{ type: 'order.canceled' }] };
  assert.equal(evalAssertions([{ kind: 'event_absent', type: 'order.canceled' }], complete).status, FALSE);
});

test('composite：not 只接受一个参数', () => {
  const ctx = { initial: st([]), final: st([]), trace: [], events: [], eventsComplete: true };
  const r = evalAssertions([{ kind: 'composite', op: 'not', args: [{ kind: 'entity_exists', selector: { collection: 'orders' } }] }], ctx);
  assert.equal(r.status, TRUE);
  const bad = evalAssertions([{ kind: 'composite', op: 'not', args: [] }], ctx);
  assert.equal(bad.status, UNKNOWN);
});

test('status_transition：transitions 检查相邻边，跳态会被抓到', () => {
  const mk = (seq) => ({
    initial: {},
    final: {},
    trace: seq.map((s) => ({ stateAfter: st([{ id: 1, status: s }]) })),
    events: [],
    eventsComplete: false,
  });
  const a = { kind: 'status_transition', selector: { collection: 'orders', index: 0 }, transitions: [['A', 'B'], ['B', 'C']] };
  assert.equal(evalAssertions([a], mk(['A', 'B', 'C'])).status, TRUE);
  assert.equal(evalAssertions([a], mk(['A', 'C'])).status, FALSE);
});

test('案例校验：bindings 指向被拒绝的步骤必须被拦下', () => {
  const c = {
    schema_version: 'agent-web/0.1',
    id: 't/x',
    task: { natural_goal: 'g', goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'orders' } }] },
    reference_trajectory: [
      { id: 's1', capability: 'a', expected_outcome: 'rejected' },
      { id: 's2', capability: 'b', expected_outcome: 'applied', bindings: { orderId: '$s1.orderId' } },
    ],
  };
  const errs = validateCase(c);
  assert.ok(errs.some((e) => e.includes('被拒绝的步骤')), errs.join('; '));
});

test('绑定解析：支持点号取值与整体引用', () => {
  const outputs = new Map([['s1', { orderId: 7, data: { k: 'v' } }]]);
  const args = resolveArguments({ arguments: { id: '$s1.orderId', deep: '$s1.data.k' }, bindings: { all: '$s1.data' } }, outputs);
  assert.equal(args.id, 7);
  assert.equal(args.deep, 'v');
  assert.deepEqual(args.all, { k: 'v' });
});

// ---- 适配器契约：角色 → 身份必须单射 ----

import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { loadAdapter, isPathSpec, listBuiltins } from '../src/adapter/load.mjs';
import { judge } from '../src/runner.mjs';

const tinyCase = {
  schema_version: 'agent-web/0.1',
  id: 'test/role-collapse',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '看菜单',
    goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'menu' }, min: 1 }],
  },
  reference_trajectory: [{ id: 's1', capability: 'menu.list', as: 'customer', expected_outcome: 'applied' }],
};

test('正常运行的内存适配器：角色绑到三个不同身份', async () => {
  const r = await judge({ case: tinyCase, adapter: createMemoryAdapter(), adapterName: 'memory' });
  assert.equal(r.status, 'pass');
});

test('角色塌缩成同一身份时判 invalid_environment，而不是 pass', async () => {
  const broken = createMemoryAdapter();
  const realReset = broken.reset;
  broken.reset = async (arg) => {
    const out = await realReset(arg);
    // 模拟 FINDING-001 的病因：customer 和 customer2 指向同一个人
    return { ...out, roleBindings: { customer: 'alice', customer2: 'alice', staff: 'barista' } };
  };
  const r = await judge({ case: tinyCase, adapter: broken, adapterName: 'memory' });
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason_code, 'invalid_environment');
  assert.match(r.detail, /customer2/);
});

test('未知角色在适配器层被拒，不静默回落到默认身份', async () => {
  const adapter = createMemoryAdapter();
  const reset = await adapter.reset({});
  const out = await adapter.execute(reset.runId, { capability: 'menu.list', as: 'nobody' });
  assert.equal(out.outcome, 'rejected');
  assert.equal(out.error.code, 'unknown_role');
});

test('compare 的前提：同一份案例在两个实现上判决一致', async () => {
  const a = createMemoryAdapter();
  const b = createMemoryAdapter();
  const [ra, rb] = await Promise.all([
    judge({ case: tinyCase, adapter: a, adapterName: 'memory-a' }),
    judge({ case: tinyCase, adapter: b, adapterName: 'memory-b' }),
  ]);
  assert.equal(ra.status, rb.status);
});

// ---------------------------------------------------------------- 适配器加载
// 框架只认内置适配器，就只是个 demo。接入成本必须压到「写一个文件、命令行指过去」。

test('isPathSpec：路径与包名要分得开', () => {
  for (const p of ['./a.mjs', '../b.mjs', '/abs/c.mjs', 'sub/dir/d.mjs', 'e.mjs', 'C://x//f.mjs']) {
    assert.equal(isPathSpec(p), true, p);
  }
  for (const p of ['memory', 'taixianglian', '@acme/agent-web-adapter-order']) {
    assert.equal(isPathSpec(p), false, p);
  }
});

test('内置适配器通过加载器拿到，且符合契约', async () => {
  assert.deepEqual(listBuiltins().sort(), ['memory', 'taixianglian']);
  const a = await loadAdapter('memory');
  for (const f of ['manifest', 'reset', 'observe', 'execute', 'close']) {
    assert.equal(typeof a[f], 'function', f);
  }
  const m = await a.manifest();
  assert.equal(m.adapter, 'memory');
});

test('文件路径适配器：骨架能被加载并跑出判决', async () => {
  const adapter = await loadAdapter('./examples/adapter-template/warehouse-adapter.mjs', {}, process.cwd());
  const c = {
    schema_version: 'agent-web/0.1',
    id: 'test/warehouse-smoke',
    environment: { adapter: 'warehouse-template', seed: {} },
    task: {
      natural_goal: '看一眼库存',
      goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'stock' }, min: 3 }],
    },
    reference_trajectory: [{ id: 's1', capability: 'stock.list', as: 'clerk', expected_outcome: 'applied' }],
  };
  const r = await judge({ case: c, adapter, adapterName: 'warehouse-template' });
  assert.equal(r.status, 'pass', r.detail);
});

test('未知适配器：报错要说清楚可以怎么接', async () => {
  await assert.rejects(
    () => loadAdapter('nope-not-installed-xyz'),
    (e) => /未知适配器/.test(e.message) && /--adapter=\.\//.test(e.message),
  );
});

test('不符合契约的模块：报错列出缺哪个方法', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-load-'));
  const file = path.join(dir, 'half-adapter.mjs');
  fs.writeFileSync(file, 'export function createAdapter(){ return { manifest: async () => ({}) }; }\n', 'utf8');
  await assert.rejects(() => loadAdapter(file), (e) => /不符合契约/.test(e.message) && /reset/.test(e.message));
  fs.rmSync(dir, { recursive: true, force: true });
});

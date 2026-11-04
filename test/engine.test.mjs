import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TRUE, FALSE, UNKNOWN, and, or, not } from '../src/three-valued.mjs';
import { getPath, fingerprint, deepEqual, stableStringify } from '../src/values.mjs';
import { selectEntities, validateSelector } from '../src/select.mjs';
import { evalAssertions, validateAssertion, phaseOf } from '../src/assert/index.mjs';
import { validateCase, resolveArguments, acceptCase, draftBlocker } from '../src/case.mjs';
import { auditRuns } from '../src/audit.mjs';
import { collectUsage, summarizeCoverage, coverageVerdict } from '../src/coverage.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = path.join(REPO_ROOT, 'bin', 'agent-web.mjs');
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

// ---------------------------------------------------------------- 视图契约
// 视图从默契变成声明。断言写在视图上，所以视图形状必须可校验。

const { validateViewContract, checkStateAgainstView, diffViews, VIEW_VERSION } = await import('../src/view.mjs');

const goodView = {
  version: VIEW_VERSION,
  collections: {
    orders: { kind: 'list', required: ['id', 'status'], semantics: '订单' },
    menu: { kind: 'list', required: ['id'] },
  },
};

test('视图契约：版本、kind、required 都要校验', () => {
  assert.deepEqual(validateViewContract(undefined), []);
  assert.deepEqual(validateViewContract(goodView), []);
  assert.match(validateViewContract({ ...goodView, version: 'v0' })[0], /version/);
  assert.match(validateViewContract({ version: VIEW_VERSION, collections: {} })[0], /不能为空/);
  assert.match(
    validateViewContract({ version: VIEW_VERSION, collections: { a: { kind: 'map' } } })[0],
    /kind/,
  );
  assert.match(
    validateViewContract({ version: VIEW_VERSION, collections: { a: { kind: 'list', required: 'id' } } })[0],
    /required/,
  );
});

test('视图契约：缺集合 / kind 不符 / 缺字段都要报出来', () => {
  const ok = checkStateAgainstView({ orders: [{ id: 1, status: 'A' }], menu: [{ id: 1 }] }, goodView);
  assert.equal(ok.ok, true);

  const missing = checkStateAgainstView({ menu: [] }, goodView);
  assert.equal(missing.ok, false);
  assert.equal(missing.errors[0].code, 'missing_collection');
  assert.match(missing.errors[0].detail, /orders/);

  const wrongKind = checkStateAgainstView({ orders: { id: 1 }, menu: [] }, goodView);
  assert.equal(wrongKind.errors[0].code, 'wrong_kind');

  const missingField = checkStateAgainstView({ orders: [{ id: 1 }], menu: [] }, goodView);
  assert.equal(missingField.errors[0].code, 'missing_field');
  assert.match(missingField.errors[0].detail, /status/);
});

test('视图契约：集合明确给 null 表示这次没有，不算违约', () => {
  const r = checkStateAgainstView({ orders: null, menu: [] }, goodView);
  assert.equal(r.ok, true);
});

test('视图契约差异：required 不同就是不可比', () => {
  const same = diffViews(goodView, structuredClone(goodView));
  assert.equal(same.compatible, true);

  const narrower = structuredClone(goodView);
  narrower.collections.orders.required = ['id'];
  const d = diffViews(goodView, narrower);
  assert.equal(d.compatible, false);
  assert.ok(d.differences.some((x) => /orders/.test(x)));

  const extra = structuredClone(goodView);
  extra.collections.pickings = { kind: 'list' };
  const e = diffViews(goodView, extra);
  assert.deepEqual(e.onlyB, ['pickings']);
});

test('契约不满足判 invalid_environment，而不是逐条断言报没观测到', async () => {
  const broken = createMemoryAdapter();
  const realObserve = broken.observe;
  broken.observe = async (runId) => {
    const out = await realObserve(runId);
    // 模拟"接错字段"：适配器把 status_log 投影成了 logs
    const { status_log, ...rest } = out.state;
    return { ...out, state: { ...rest, logs: status_log } };
  };
  const r = await judge({ case: tinyCase, adapter: broken, adapterName: 'memory' });
  assert.equal(r.status, 'unknown');
  assert.equal(r.reason_code, 'invalid_environment');
  assert.match(r.detail, /视图契约/);
  assert.match(r.detail, /status_log/);
});

// ---- v0.2：事件词表 / 候选轨迹 ----

test('event_absent：适配器不记录的事件类型，退回 unknown 而不是 TRUE', async () => {
  const { event_absent } = await import('../src/assert/kinds.mjs');
  const ctx = {
    events: [],
    eventsComplete: true,
    eventsVocabulary: ['order.making', 'order.ready'],
  };
  const r = event_absent({ kind: 'event_absent', type: 'order.created' }, ctx);
  assert.equal(r.status, UNKNOWN);
  assert.equal(r.code, 'unsupported_event');
  // 词表里有的类型照常判
  const ok2 = event_absent({ kind: 'event_absent', type: 'order.making' }, ctx);
  assert.equal(ok2.status, TRUE);
  // 没声明词表的老适配器：维持原语义，只信 events_complete
  const legacy = event_absent({ kind: 'event_absent', type: 'order.created' }, { events: [], eventsComplete: true });
  assert.equal(legacy.status, TRUE);
});

test('judge：候选轨迹优先于参考轨迹，并记录来源', async () => {
  const { judge } = await import('../src/runner.mjs');
  const { createMemoryAdapter } = await import('../src/adapter/memory.mjs');
  const c = JSON.parse(fs.readFileSync(new URL('../cases/coffee/happy-path.json', import.meta.url), 'utf8'));

  const adapter = createMemoryAdapter();
  const full = await judge({ case: c, adapter, adapterName: 'memory' });
  assert.equal(full.trajectory_source, 'reference');
  assert.equal(full.status, 'pass');

  // 只下单不取餐：同一份案例，换个轨迹就该判 fail
  const lazy = [c.reference_trajectory[0]];
  const half = await judge({ case: c, adapter: createMemoryAdapter(), adapterName: 'memory', trajectory: lazy });
  assert.equal(half.trajectory_source, 'candidate');
  assert.equal(half.status, 'fail');
  assert.equal(half.reason_code, 'assertion_false');
});

test('judge：结构不合法的候选轨迹不进执行', async () => {
  const { judge } = await import('../src/runner.mjs');
  const { createMemoryAdapter } = await import('../src/adapter/memory.mjs');
  const c = JSON.parse(fs.readFileSync(new URL('../cases/coffee/happy-path.json', import.meta.url), 'utf8'));
  const v = await judge({
    case: c,
    adapter: createMemoryAdapter(),
    adapterName: 'memory',
    trajectory: [{ id: 's1' }],
  });
  assert.equal(v.status, 'unknown');
  assert.equal(v.reason_code, 'invalid_case');
  assert.ok(Array.isArray(v.errors) && v.errors.length > 0);
});

// ---- record：真实流量 → 候选轨迹 ----

const REC_MANIFEST = {
  capabilities: [
    { id: 'order.create', kind: 'write', http: 'POST /waiter/order' },
    { id: 'menu.list', kind: 'read', http: 'GET /waiter/menu' },
    { id: 'kitchen.accept', kind: 'write', http: 'POST /kitchen/order/{id}/accept' },
  ],
};
const REC_ADAPTER = {
  toStep(entry, matched) {
    if (matched.capability === 'order.create') {
      return { items: (entry.body.dishList ?? []).map((x) => ({ dishName: x.dishName, qty: x.count })) };
    }
    return { orderId: Number(matched.params.id) };
  },
};

test('record：反查能力靠 http 模板，参数靠适配器 toStep', async () => {
  const { matchHttp } = await import('../src/record.mjs');
  const hit = matchHttp(REC_MANIFEST, 'POST', '/kitchen/order/7/accept');
  assert.equal(hit.capability, 'kitchen.accept');
  assert.deepEqual(hit.params, { id: '7' });
  assert.equal(matchHttp(REC_MANIFEST, 'POST', '/kitchen/order/7/ready'), null);
});

test('record：业务码决定结局，连不上不记成 rejected', async () => {
  const { outcomeOf } = await import('../src/record.mjs');
  assert.equal(outcomeOf({ status: 200, response: { code: 200 } }), 'applied');
  assert.equal(outcomeOf({ status: 200, response: { code: 40901 } }), 'rejected');
  assert.equal(outcomeOf({ status: 200, response: { code: 40101 } }), null);
  assert.equal(outcomeOf({ status: 0, response: null }), null);
});

test('record：绑定指向第一个产出该 id 的步，读操作默认不录', async () => {
  const { inferSteps } = await import('../src/record.mjs');
  const entries = [
    { as: 'customer', method: 'GET', path: '/waiter/menu', status: 200, response: { code: 200, data: [] } },
    { as: 'customer', method: 'POST', path: '/waiter/order', body: { dishList: [{ dishName: '拿铁', count: 2 }] }, status: 200, response: { code: 200, data: { id: 42 } } },
    { as: 'staff', method: 'POST', path: '/kitchen/order/42/accept', status: 200, response: { code: 200, data: { id: 42 } } },
    { as: 'staff', method: 'POST', path: '/kitchen/order/42/accept', status: 200, response: { code: 200, data: { id: 42 } } },
  ];
  const { steps, skipped } = inferSteps({ entries, manifest: REC_MANIFEST, adapter: REC_ADAPTER });
  assert.equal(steps.length, 3);
  assert.equal(skipped[0].reason, 'read_skipped');
  assert.deepEqual(steps[0].arguments, { items: [{ dishName: '拿铁', qty: 2 }] });
  // 第 2、3 步的 orderId 都指回产出它的那一步，不串成链
  assert.equal(steps[1].bindings.orderId, '$s1.orderId');
  assert.equal(steps[2].bindings.orderId, '$s1.orderId');
});

test('record：没有执行者角色的请求跳过，不瞎猜', async () => {
  const { inferSteps } = await import('../src/record.mjs');
  const entries = [{ method: 'POST', path: '/waiter/order', body: { dishList: [{ dishName: '拿铁', count: 1 }] }, status: 200, response: { code: 200, data: { id: 1 } } }];
  const { steps, skipped } = inferSteps({ entries, manifest: REC_MANIFEST, adapter: REC_ADAPTER });
  assert.equal(steps.length, 0);
  assert.equal(skipped[0].reason, 'missing_as');
});

// ---- draft：轨迹回放 → 断言草稿 ----

const DRAFT_MANIFEST = {
  events_scope: 'status_log',
  capabilities: [
    { id: 'order.create', kind: 'write' },
    { id: 'order.pick', kind: 'write' },
    { id: 'menu.list', kind: 'read' },
  ],
  view: {
    collections: {
      menu: { kind: 'list' },
      orders: { kind: 'list' },
      status_log: { kind: 'list' },
    },
  },
};

function draftStates(orders, log = []) {
  return {
    menu: [{ id: 'latte', dishName: '拿铁', price: 28 }],
    orders,
    status_log: log,
  };
}

test('draft：实体身份优先用 id，没有 id 才退回指纹', async () => {
  const { identityOf } = await import('../src/draft.mjs');
  assert.equal(identityOf({ id: 7, status: 'PENDING' }), 'id:7');
  assert.match(identityOf({ status: 'PENDING' }), /^fp:fnv1a32:/);
});

test('draft：合成 count_delta / field_equals / status_transition，不碰事件流水与环境字段', async () => {
  const { synthesize } = await import('../src/draft.mjs');
  const order = (status) => ({ id: 7, status, totalAmount: 28, createTime: 123, items: [{ dishName: '拿铁', count: 1 }] });
  const initial = draftStates([]);
  const final = draftStates([order('PICKED')], [{ type: 'order.created', orderId: 7, from: null, to: 'PENDING' }]);
  const trace = [{ stateAfter: draftStates([order('PENDING')]) }, { stateAfter: final }];

  const s = synthesize({ initial, final, trace, manifest: DRAFT_MANIFEST, steps: [] });
  const kinds = s.goal_assertions.map((a) => a.kind);
  assert.deepEqual(kinds, ['count_delta', 'field_equals', 'status_transition']);
  assert.equal(s.goal_assertions[0].delta, 1);
  assert.equal(s.goal_assertions[1].path, 'status');
  assert.equal(s.goal_assertions[1].value, 'PICKED');
  assert.deepEqual(s.goal_assertions[2].transitions, [['PENDING', 'PICKED']]);

  // 换一次 reset 就变的字段不许进断言
  const paths = s.goal_assertions.filter((a) => a.kind === 'field_equals').map((a) => a.path);
  assert.ok(!paths.includes('id'));
  assert.ok(!paths.includes('createTime'));

  // 事件流水不进 count_delta，但要给出原因
  assert.ok(!s.goal_assertions.some((a) => a.selector?.collection === 'status_log'));
  assert.ok(s.todo.some((t) => t.includes('status_log') && t.includes('事件粒度')));

  // 没动的集合进不变量，不进目标
  assert.deepEqual(s.invariants.map((a) => a.scopes), [['menu']]);
});

test('draft：新增多条时不替人挑判据对象', async () => {
  const { synthesize } = await import('../src/draft.mjs');
  const order = (id, status) => ({ id, status, totalAmount: 28, createTime: 1, items: [] });
  const initial = draftStates([]);
  const final = draftStates([order(1, 'PENDING'), order(2, 'PENDING')]);
  const s = synthesize({ initial, final, trace: [], manifest: DRAFT_MANIFEST, steps: [] });
  assert.ok(!s.goal_assertions.some((a) => a.kind === 'field_equals'));
  assert.ok(s.todo.some((t) => t.includes('新增 2 条')));
  // 计数仍然写：条数变化是确定的
  assert.equal(s.goal_assertions[0].delta, 2);
});

test('draft：回放 → 草稿（须确认）→ 自检 pass，且负例能力留在白名单里', async () => {
  const { createMemoryAdapter } = await import('../src/adapter/memory.mjs');
  const { replayTrajectory, buildDraftCase } = await import('../src/draft.mjs');
  const { judge } = await import('../src/runner.mjs');
  const adapter = createMemoryAdapter();
  const manifest = await adapter.manifest();

  const steps = [
    { id: 's1', capability: 'order.create', as: 'customer', expected_outcome: 'applied', arguments: { items: [{ dishName: '拿铁', qty: 1 }] } },
    { id: 's2', capability: 'kitchen.accept', as: 'staff', expected_outcome: 'applied', bindings: { orderId: '$s1.orderId' } },
    { id: 's3', capability: 'order.pick', as: 'customer2', expected_outcome: 'rejected', bindings: { orderId: '$s1.orderId' } },
  ];

  const r = await replayTrajectory({ adapter, steps, scopes: manifest.scopes, seed: {} });
  assert.equal(r.ok, true);
  assert.equal(r.final.orders.length, 1);

  const { case: c } = buildDraftCase({
    id: 'draft/neg',
    adapterName: 'memory',
    seed: {},
    source: 'test',
    steps,
    initial: r.initial,
    final: r.final,
    trace: r.trace,
    manifest,
    scopes: manifest.scopes,
  });
  assert.deepEqual(validateCase(c), []);
  // 被拒绝的步也必须在白名单里，否则 runner 在调用适配器之前就判 invalid_action
  assert.ok(c.task.allowed_capabilities.includes('order.pick'));
  assert.equal(c.draft.status, 'unconfirmed');
  // 断言里不许出现具体 id：内存适配器从 1001 起编号，换到真实后端就是 2
  assert.ok(!JSON.stringify(c.task.goal_assertions).includes('1001'), '断言里钉死了环境相关的 id');

  // 草稿必须先过人这一关：没人确认过的机器生成案例，不给判决
  const blocked = await judge({ case: c, adapter, adapterName: 'memory' });
  assert.equal(blocked.status, 'unknown');
  assert.equal(blocked.reason_code, 'unconfirmed_draft');

  const accepted = acceptCase(c, { by: 'YG' });
  const v = await judge({ case: accepted, adapter, adapterName: 'memory' });
  assert.equal(v.status, 'pass', v.detail);
});

test('draft：轨迹跑不通就不生成草稿', async () => {
  const { createMemoryAdapter } = await import('../src/adapter/memory.mjs');
  const { replayTrajectory } = await import('../src/draft.mjs');
  const adapter = createMemoryAdapter();
  const manifest = await adapter.manifest();
  const steps = [
    { id: 's1', capability: 'order.pick', as: 'customer', expected_outcome: 'applied', arguments: { orderId: 999 } },
  ];
  const r = await replayTrajectory({ adapter, steps, scopes: manifest.scopes, seed: {} });
  assert.equal(r.ok, false);
  assert.equal(r.aborted.code, 'unexpected_rejection');
  assert.equal(r.aborted.at, 0);
});

test('flow：候选判决使用实际执行轨迹与证据', async () => {
  const { buildFlowModel } = await import('../src/flow.mjs');
  const c = {
    id: 'demo/flow',
    task: { natural_goal: '完成订单', goal_assertions: [{ kind: 'field_equals', selector: { collection: 'orders', index: 0 }, path: 'status', value: 'READY' }] },
    reference_trajectory: [{ id: 'r1', capability: 'order.create', as: 'customer', expected_outcome: 'applied' }],
  };
  const verdict = {
    case_id: c.id,
    status: 'fail',
    reason_code: 'assertion_false',
    trajectory_source: 'candidate',
    evidence: {
      trace: [{ index: 0, id: 'c1', capability: 'order.pick', as: 'customer2', outcome: 'rejected', expected_outcome: 'applied', error: { code: 'not_owner', message: 'not owner' } }],
      events: [{ type: 'order.ready', from: 'MAKING', to: 'READY', by: 'staff', orderId: 2 }],
      events_complete: true,
    },
    goal_results: [{ index: 0, kind: 'field_equals', status: 'false', code: 'field_mismatch', message: 'status mismatch' }],
    invariant_results: [],
  };
  const model = buildFlowModel({ case: c, verdict });
  assert.equal(model.trajectorySource, 'candidate');
  assert.equal(model.steps[0].id, 'c1');
  assert.equal(model.steps[0].actual, 'rejected');
  assert.equal(model.steps[0].role, 'customer2');
  assert.equal(model.events[0].from, 'MAKING');
  assert.equal(model.eventsComplete, true);
  assert.equal(model.assertions[0].result, 'false');

  const noExecution = buildFlowModel({
    case: c,
    verdict: { trajectory_source: 'candidate', evidence: { trace: [] } },
  });
  assert.deepEqual(noExecution.steps, [], '候选步骤没执行时，不要伪装成参考步骤');
});

test('flow：HTML 自包含且对动态内容做 HTML / script 转义', async () => {
  const { renderFlowHtml } = await import('../src/flow.mjs');
  const html = renderFlowHtml({
    case: {
      id: 'demo/<flow>',
      task: { natural_goal: '</script><img src=x onerror=alert(1)>', goal_assertions: [] },
      reference_trajectory: [{ id: 's1', capability: 'order.create', as: 'customer', arguments: { note: '<script>alert(1)</script>', accessToken: 'not-for-export' } }],
    },
  });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /id="flow-data"/);
  assert.match(html, /<style>/);
  assert.match(html, /<script>\s*const dashRaw=/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /aria-controls="step-details-/);
  assert.match(html, /@media\(max-width:700px\)/);
  assert.doesNotMatch(html, /<script type="application\/json" id="flow-data">[^<]*<\/script><img/);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.doesNotMatch(html, /not-for-export/);
  assert.match(html, /REDACTED/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('flow：目录模式生成判决总览页（dashboard）', async () => {
  const { buildDashboardModel, renderDashboardHtml, renderFlowHtml } = await import('../src/flow.mjs');
  const makeCase = (id) => ({
    id,
    task: { natural_goal: '目标', goal_assertions: [{ kind: 'field_equals', selector: { collection: 'orders', index: 0 }, path: 'status', value: 'DONE' }] },
    reference_trajectory: [{ id: 's1', capability: 'order.create', as: 'customer', expected_outcome: 'applied' }],
  });
  const cases = [
    { case: makeCase('demo/a'), verdict: { case_id: 'demo/a', status: 'pass', reason_code: 'ok' } },
    { case: makeCase('demo/b'), verdict: { case_id: 'demo/b', status: 'fail', reason_code: 'assertion_false' } },
    { case: makeCase('demo/c'), verdict: { case_id: 'demo/c', status: 'unknown', reason_code: 'coverage_gap' } },
  ];
  const dash = buildDashboardModel({ cases, title: '总览' });
  assert.equal(dash.schema, 'agent-web/flow-dashboard/1');
  assert.equal(dash.summary.total, 3);
  assert.equal(dash.summary.withResult, 3);
  assert.equal(dash.summary.pass, 1);
  assert.equal(dash.summary.fail, 1);
  assert.equal(dash.summary.decidableRate, 2 / 3, 'unknown 留在分母里');
  assert.equal(dash.entries[0].anchor, 'case-0');
  assert.equal(dash.entries[1].caseId, 'demo/b');

  const html = renderDashboardHtml({ cases });
  assert.match(html, /id="dashboard-data"/);
  assert.equal((html.match(/class="flow-data"/g) || []).length, 3, '每个案例一个数据岛');
  assert.match(html, /id="dash-app"/);
  assert.match(html, /id="case-0"/);
  assert.match(html, /id="case-2"/);
  assert.match(html, /</);
  assert.doesNotMatch(html, /https?:\/\//);

  const single = renderFlowHtml({ case: makeCase('demo/a'), verdict: cases[0].verdict });
  assert.equal((single.match(/class="flow-data"/g) || []).length, 1, '单案例模式只有一个数据岛');
  assert.doesNotMatch(single, /id="dashboard-data"/, '单案例模式不渲染总览头（查元素，不查脚本里的选择器）');
  assert.match(single, /id="flow-data"/);
});

test('flow：目录模式的命令行入口', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-flow-dash-'));
  try {
    const out = path.join(tempRoot, 'dash.html');
    const results = path.join(tempRoot, 'results.jsonl');
    const vr = runCli(['verify', path.join(REPO_ROOT, 'cases', 'coffee'), '--adapter=memory', '--out=' + results]);
    assert.equal(vr.status, 0, vr.stderr);
    const r = runCli(['flow', path.join(REPO_ROOT, 'cases', 'coffee'), '--result=' + results, '--out=' + out]);
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(out, 'utf8');
    assert.match(html, /id="dashboard-data"/);
    assert.ok(html.length > 10000, '总览页包含全部案例');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

test('prepare：从动作日志一次生成步骤、未确认案例和流程预览', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prepare-'));
  try {
    const outDir = path.join(tempRoot, 'prepared');
    const source = path.join(REPO_ROOT, 'examples', 'agent-traces', 'memory-happy-path.jsonl');
    const r = runCli([
      'prepare', source,
      '--adapter=memory',
      '--out-dir=' + outDir,
      '--id=demo/prepared',
      '--goal=顾客下单后由本人取走',
    ]);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    const trajectory = JSON.parse(fs.readFileSync(path.join(outDir, 'trajectory.json'), 'utf8'));
    const c = JSON.parse(fs.readFileSync(path.join(outDir, 'case.draft.json'), 'utf8'));
    const html = fs.readFileSync(path.join(outDir, 'case.flow.html'), 'utf8');
    const model = JSON.parse(html.match(/<script type="application\/json" id="flow-data"[^>]*>([\s\S]*?)<\/script>/)[1]);

    assert.equal(trajectory.trajectory.length, 4);
    assert.equal(c.id, 'demo/prepared');
    assert.equal(c.draft.status, 'unconfirmed');
    assert.equal(c.task.natural_goal, '顾客下单后由本人取走');
    assert.equal(model.draftStatus, 'unconfirmed');
    assert.equal(model.verdict, null, '预览不能把草稿伪装成通过的正式案例');
    assert.equal(model.steps.length, 4);

    const verify = runCli(['verify', path.join(outDir, 'case.draft.json'), '--adapter=memory']);
    assert.equal(verify.status, 0, verify.stderr + verify.stdout);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('prepare：输出文件已存在时拒绝覆盖', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prepare-collision-'));
  try {
    const outDir = path.join(tempRoot, 'prepared');
    fs.mkdirSync(outDir);
    const keep = path.join(outDir, 'case.draft.json');
    fs.writeFileSync(keep, 'keep me', 'utf8');

    const source = path.join(REPO_ROOT, 'examples', 'agent-traces', 'memory-happy-path.jsonl');
    const r = runCli(['prepare', source, '--adapter=memory', '--out-dir=' + outDir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /避免覆盖/);
    assert.equal(fs.readFileSync(keep, 'utf8'), 'keep me');
    assert.equal(fs.existsSync(path.join(outDir, 'trajectory.json')), false);
    assert.equal(fs.existsSync(path.join(outDir, 'case.flow.html')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('prepare：没有可还原步骤或发现敏感字段时不写产物', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prepare-invalid-'));
  try {
    const emptyLog = path.join(tempRoot, 'empty.json');
    const emptyOut = path.join(tempRoot, 'empty-out');
    fs.writeFileSync(emptyLog, '[]', 'utf8');
    const empty = runCli(['prepare', emptyLog, '--adapter=memory', '--out-dir=' + emptyOut]);
    assert.equal(empty.status, 1);
    assert.equal(fs.existsSync(emptyOut), false);

    const secretLog = path.join(tempRoot, 'secret.jsonl');
    const secretOut = path.join(tempRoot, 'secret-out');
    fs.writeFileSync(secretLog, JSON.stringify({
      capability: 'order.create',
      as: 'customer',
      outcome: 'applied',
      arguments: { items: [{ dishName: '拿铁', qty: 1 }], accessToken: 'do-not-export' },
      observed: { orderId: 1001 },
    }) + '\n', 'utf8');
    const secret = runCli(['prepare', secretLog, '--adapter=memory', '--out-dir=' + secretOut]);
    assert.equal(secret.status, 2);
    assert.match(secret.stderr, /敏感字段/);
    assert.doesNotMatch(secret.stderr, /do-not-export/);
    assert.equal(fs.existsSync(secretOut), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 草稿闸门：机器生成的案例，没人确认过就不给判
// ---------------------------------------------------------------------------

function draftCase() {
  const c = JSON.parse(fs.readFileSync(new URL('../cases/coffee/happy-path.json', import.meta.url), 'utf8'));
  c.id = 'coffee/draft-gate';
  c.draft = { status: 'unconfirmed', generated_by: 'agent-web draft' };
  return c;
}

test('未确认的草稿案子不产生判决，记 unknown 并留在分母里', async () => {
  const adapter = createMemoryAdapter();
  const v = await judge({ case: draftCase(), adapter, adapterName: 'memory' });
  assert.equal(v.status, 'unknown');
  assert.equal(v.reason_code, 'unconfirmed_draft');
  assert.match(v.detail, /accept/);
});

test('确认之后同一条案例照常判决', async () => {
  const adapter = createMemoryAdapter();
  const accepted = acceptCase(draftCase(), { by: 'YG' });
  assert.equal(accepted.draft.status, 'confirmed');
  assert.equal(accepted.draft.reviewed_by, 'YG');
  const v = await judge({ case: accepted, adapter, adapterName: 'memory' });
  assert.equal(v.status, 'pass');
  assert.equal(v.reason_code, 'ok');
});

test('不接受匿名确认：确认人必须能指认', () => {
  assert.throws(() => acceptCase(draftCase(), {}), /--by/);
  assert.throws(() => acceptCase(draftCase(), { by: '   ' }), /--by/);
});

test('手写案例没有 draft 字段，本来就能判', () => {
  const c = draftCase();
  delete c.draft;
  assert.equal(draftBlocker(c), null);
});

// ---------------------------------------------------------------------------
// audit：拿真实判决当尺子，量假绿
// ---------------------------------------------------------------------------

function v(caseId, status, reason = 'ok') {
  return { case_id: caseId, status, reason_code: reason };
}

test('audit 把"真有问题却判通过"单独算成假绿，并判定证据不成立', () => {
  const oracle = [v('a', 'pass'), v('b', 'fail'), v('c', 'fail')];
  const suspect = [v('a', 'pass'), v('b', 'fail'), v('c', 'pass')];
  const r = auditRuns(oracle, suspect);
  assert.equal(r.counts.truePass, 1);
  assert.equal(r.counts.trueFail, 1);
  assert.equal(r.counts.falsePass, 1);
  assert.equal(r.sound, false);
  assert.equal(r.rates.agreement, 2 / 3);
  assert.equal(r.rates.false_pass, 1 / 2);
});

test('audit 全部一致时 sound 为真，且分母为 0 的比率是 null 而不是 0', () => {
  const rows = [v('a', 'pass'), v('b', 'fail')];
  const r = auditRuns(rows, rows);
  assert.equal(r.sound, true);
  assert.equal(r.rates.agreement, 1);
  assert.equal(r.rates.false_alarm, 0);
  assert.equal(r.rates.false_pass, 0);
  assert.equal(r.rates.blind, 0);
});

test('audit 区分漏判、仅候选敢判与两侧不一致的案例集', () => {
  const oracle = [v('a', 'pass'), v('b', 'unknown'), v('only1', 'pass')];
  const suspect = [v('a', 'unknown'), v('b', 'pass'), v('only2', 'fail')];
  const r = auditRuns(oracle, suspect);
  assert.equal(r.counts.blind, 1);
  assert.equal(r.counts.candidate_only, 1);
  assert.equal(r.counts.only_oracle, 1);
  assert.equal(r.counts.only_candidate, 1);
  assert.equal(r.rates.blind, 1);
  assert.equal(r.sound, true);
});

test('coverage：把用过的、闲置的、案例要但没声明的分开算', () => {
  const manifest = {
    adapter: 'x',
    capabilities: [
      { id: 'order.create', kind: 'write', evidence_level: 'validated' },
      { id: 'order.list', kind: 'read', evidence_level: 'observed' },
      { id: 'menu.edit', kind: 'write', evidence_level: 'inferred' },
    ],
  };
  const cases = [
    { id: 'c1', reference_trajectory: [{ capability: 'order.create' }, { capability: 'order.create' }] },
    { id: 'c2', reference_trajectory: [{ capability: 'order.list' }, { capability: 'order.refund' }] },
  ];
  const report = summarizeCoverage(collectUsage(cases, manifest));

  assert.equal(report.declared, 3);
  assert.equal(report.used, 2);
  assert.equal(report.unused, 1);
  assert.equal(report.missing, 1);
  assert.equal(report.missing_list[0].id, 'order.refund');
  assert.equal(report.missing_list[0].steps, 1);
  assert.deepEqual(report.missing_list[0].cases, ['c2']);
  assert.deepEqual(report.unused_list.map((u) => u.id), ['menu.edit']);
  // 行里的 steps 是"被要了几步"，不是"几条案例"，两者不能混
  const created = collectUsage(cases, manifest).rows.find((r) => r.id === 'order.create');
  assert.equal(created.steps, 2);
  assert.deepEqual(created.cases, ['c1']);
});

test('coverage：覆盖率是 用到的/声明的，且分母为 0 时是 null 不是 0', () => {
  const cases = [{ id: 'c1', reference_trajectory: [{ capability: 'a' }] }];
  const one = summarizeCoverage(collectUsage(cases, {
    adapter: 'x',
    capabilities: [{ id: 'a', kind: 'read', evidence_level: 'validated' }, { id: 'b', kind: 'read', evidence_level: 'validated' }],
  }));
  assert.equal(one.rate.value, 0.5);

  const none = summarizeCoverage(collectUsage(cases, { adapter: 'x', capabilities: [] }));
  assert.equal(none.rate.value, null, '一个能力都没声明时，覆盖率是没意义的，不能写 0%');
});

test('coverage：案例要观测但 manifest 没声明的集合单独记', () => {
  const manifest = { adapter: 'x', capabilities: [], scopes: ['orders'] };
  const cases = [
    { id: 'c1', observability: { declared_scopes: ['orders', 'status_log'] }, reference_trajectory: [] },
  ];
  const report = summarizeCoverage(collectUsage(cases, manifest));
  assert.equal(report.scope.declared, 1);
  assert.equal(report.scope.asked, 2);
  assert.equal(report.scope.missing, 1);
  assert.equal(report.scope_missing_list[0].scope, 'status_log');
});

test('coverage：有缺口就不通过；缺口为 0 但没到门槛也不通过', () => {
  const gap = summarizeCoverage(collectUsage(
    [{ id: 'c1', reference_trajectory: [{ capability: 'ghost' }] }],
    { adapter: 'x', capabilities: [{ id: 'a', kind: 'read', evidence_level: 'validated' }] },
  ));
  assert.equal(coverageVerdict(gap).ok, false);

  const clean = summarizeCoverage(collectUsage(
    [{ id: 'c1', reference_trajectory: [{ capability: 'a' }] }],
    {
      adapter: 'x',
      capabilities: [
        { id: 'a', kind: 'read', evidence_level: 'validated' },
        { id: 'b', kind: 'read', evidence_level: 'validated' },
      ],
    },
  ));
  assert.equal(coverageVerdict(clean).ok, true);
  assert.equal(coverageVerdict(clean, { min: 0.8 }).ok, false);
  assert.equal(coverageVerdict(clean, { min: 0.5 }).ok, true);
});

test('加载外部适配器之前会提醒这是可执行代码，且能被环境变量关掉', () => {
  const base = ['coverage', 'examples/adapter-template/cases', '--adapter=./examples/adapter-template/warehouse-adapter.mjs'];
  const loud = spawnSync(process.execPath, [CLI_PATH, ...base], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.match(loud.stderr, /正在加载外部适配器/, '外部适配器必须先提醒再 import');

  const quiet = spawnSync(process.execPath, [CLI_PATH, ...base], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, AGENT_WEB_QUIET_ADAPTER_WARNING: '1' },
  });
  assert.doesNotMatch(quiet.stderr, /正在加载外部适配器/);
});

test('--out 的父目录不存在时自己建出来（干净克隆上 CI 就死在这）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-out-'));
  const target = path.join(root, 'deep', 'nested', 'r.jsonl');
  assert.equal(fs.existsSync(path.dirname(target)), false, '前置：父目录不该存在');

  const r = spawnSync(
    process.execPath,
    [CLI_PATH, 'verify', 'cases/coffee', '--adapter=memory', '--out=' + target],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );

  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(target), true, '父目录不存在时 verify 必须自己建出来');
  const lines = fs.readFileSync(target, 'utf8').trim().split('\n');
  // 条数从 expected.json 推，不写死 —— 写死的话每加一条案例就要来改这里，
  // 而这个测试要守的是「父目录被建出来了」，不是案例数量。
  const expectedCount = Object.keys(
    JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'cases', 'coffee', 'expected.json'), 'utf8')),
  ).length;
  assert.equal(lines.length, expectedCount);
  fs.rmSync(root, { recursive: true, force: true });
});

test('每个案例都在 expected.json 里有预期，且预期表里没有不存在的案例', () => {
  const dir = path.join(REPO_ROOT, 'cases', 'coffee');
  const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  const ids = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'expected.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).id);

  const missing = ids.filter((id) => !(id in expected));
  const extra = Object.keys(expected).filter((k) => !ids.includes(k));
  assert.deepEqual(missing, [], '这些案例没有预期，等于没被判过');
  assert.deepEqual(extra, [], '预期表里有已经不存在的案例');
  assert.equal(ids.length, Object.keys(expected).length);
});

test('版本号只有一处真相：package.json，CHANGELOG 与 CLI 都必须跟它一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const log = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
  const top = log.match(/^##\s+(\d+\.\d+\.\d+)/m);
  assert.ok(top, 'CHANGELOG 必须有一个「## x.y.z」形式的首条版本');
  assert.equal(top[1], pkg.version, 'CHANGELOG 首条版本必须等于 package.json');

  const v = spawnSync(process.execPath, [CLI_PATH, '--version'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(v.status, 0);
  assert.equal(v.stdout.trim(), `${pkg.name} ${pkg.version}`, 'CLI 报的版本必须等于 package.json');
});

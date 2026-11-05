#!/usr/bin/env node
/**
 * 新增的断言种类必须证明自己有用。
 *
 * 宪法：每加一种 kind，必须能被 certify 杀掉至少一个变异体。
 * 只证明「能杀」还不够 —— field_equals 几乎什么都能杀，那它就该独吞所有位置。
 * 所以这里判两件事：
 *
 *   1 这个 kind 至少杀掉一个变异体（不是空转）
 *   2 至少有一个变异体**只有它能杀**（去掉这条断言就漏网）
 *
 * 第 2 条才是"必要性"。一条断言如果换成 field_equals 也能杀，它就没有带来新的表达力，
 * 只是让案例更难读。
 *
 * 用法：node scripts/kind-necessity.mjs
 * 退出码：0 每种都过了；1 有 kind 过不了（应当重新设计或删掉它）
 */

import { certify } from '../src/certify.mjs';
import { MUTATIONS } from '../src/mutate.mjs';
import { loadAdapter } from '../src/adapter/load.mjs';
import { KINDS } from '../src/assert/index.mjs';
import { readFileSync } from 'node:fs';

const CANCELLED = ['PENDING', 'MAKING', 'READY', 'PICKED', 'CANCELED'];

/** 两条订单，这样 sorted_by / unique 才有东西可看。 */
function shapeCase(assertions) {
  return {
    schema_version: 'agent-web/0.1',
    id: 'necessity/shape',
    title: '形状断言的必要性检验',
    environment: { adapter: 'memory' },
    task: { natural_goal: '下两单，看这两单的集合形状', goal_assertions: assertions, preconditions: [] },
    reference_trajectory: [
      { id: 's1', capability: 'order.create', as: 'customer', arguments: { items: [{ dishName: '拿铁', qty: 2 }] }, expected_outcome: 'applied' },
      { id: 's2', capability: 'order.create', as: 'customer', arguments: { items: [{ dishName: '美式咖啡', count: 3 }] }, expected_outcome: 'applied' },
    ],
    invariants: [],
  };
}

/**
 * 时间窗 / 每步求值这两个 kind 不在上面那条「两单」案例里求值 ——
 * 它们看的是「某一段」和「每一步」，需要一条多步案例才测得出来。
 * 所以各配一条专用案例，再各配一个只有它能杀的变异体。
 */
/**
 * 时间窗 / 每步求值这两个 kind 需要多步案例才测得出来，所以直接用仓库里那两条真案例，
 * 只替换 invariants —— 用手编的迷你案例测，量到的是「我编的案例」而不是「我们的案例」。
 */
function fromReal(id, invariants) {
  const raw = readFileSync(new URL(`../cases/coffee/${id}.json`, import.meta.url), 'utf8');
  const c = JSON.parse(raw);
  const task = { ...c.task, invariants };
  return { ...c, task };
}

const TEMPORAL = [
  // skip-ready-stage 的第 3 步会被拒；那一步之后不该多出流水
  { kind: 'window', caseId: 'skip-ready-stage', invariant: { kind: 'window', from_step: 2, to_step: 3, of: { kind: 'unchanged', scopes: ['status_log'] } } },
  // happy-path 五步走完；菜单是只读数据，任何一步之后都不该变
  { kind: 'every_step', caseId: 'happy-path', invariant: { kind: 'every_step', of: { kind: 'unchanged', scopes: ['menu'] } } },
];

/**
 * 分页也一样：它读的是每一步的执行返回（payload），视图里看不到，
 * 所以必须用一条真的翻了页的案例（cases/coffee/paged-orders.json）来测。
 * 去掉这条断言时基线留一条 entity_exists，避免空 goal_assertions 让案例本身不合法。
 */
function withGoal(id, assertions) {
  const c = fromReal(id, []);
  return { ...c, task: { ...c.task, goal_assertions: assertions } };
}

const PAGED = {
  kind: 'pagination',
  caseId: 'paged-orders',
  assertion: { kind: 'pagination', collection: 'orders', steps: [6, 7, 8], total: 5, pageSize: 2, ordered_by: 'id' },
  baseline: [{ kind: 'entity_exists', selector: { collection: 'orders' } }],
};

const PAYLOAD_SPEC = [
  {
    kind: 'payload',
    caseId: 'payload-echo',
    assertion: { kind: 'payload', step: 3, path: '$.orders', op: 'count_gte', value: 2 },
    baseline: [{ kind: 'count_delta', selector: { collection: 'orders' }, delta: 2 }],
  },
];

const SHAPE = [
  { kind: 'entity_exists', selector: { collection: 'orders', index: 0 } },
  { kind: 'count_delta', selector: { collection: 'orders' }, delta: 2 },
  { kind: 'unique', selector: { collection: 'orders' }, path: 'id' },
  { kind: 'type_of', selector: { collection: 'orders' }, path: 'totalAmount', type: 'number' },
  { kind: 'subset', selector: { collection: 'orders' }, path: 'status', values: CANCELLED },
  { kind: 'sorted_by', selector: { collection: 'orders' }, path: 'createTime', order: 'asc' },
];

async function run() {
  const pool = MUTATIONS;
  const factory = async () => loadAdapter('memory');

  const full = await certify({ cases: [shapeCase(SHAPE)], adapterFactory: factory, adapterName: 'memory', mutations: pool });

  const only = (kind) => {
    // 去掉这一条，重跑，看哪些变异体从「抓住」变成「漏网」
    const without = SHAPE.filter((a) => a.kind !== kind);
    return certify({
      cases: [shapeCase(without)],
      adapterFactory: factory,
      adapterName: 'memory',
      mutations: pool,
    }).then((r) => {
      const caughtBefore = new Set(full.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
      const caughtAfter = new Set(r.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
      return [...caughtBefore].filter((id) => !caughtAfter.has(id));
    });
  };


  // 响应体断言：去掉它，m-payload-truncate 就该漏网。
  for (const spec of PAYLOAD_SPEC) {
    const withIt = await certify({ cases: [withGoal(spec.caseId, [...spec.baseline, spec.assertion])], adapterFactory: factory, adapterName: 'memory', mutations: pool });
    const without = await certify({ cases: [withGoal(spec.caseId, [...spec.baseline])], adapterFactory: factory, adapterName: 'memory', mutations: pool });
    const kills = withIt.mutations.filter((m) => (m.killedBy ?? []).some((k) => (typeof k === 'string' ? k : k.kind) === spec.kind));
    const caughtWith = new Set(withIt.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
    const caughtWithout = new Set(without.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
    const necessary = [...caughtWith].filter((id) => !caughtWithout.has(id));
    const ok = kills.length > 0 && necessary.length > 0;
    if (!ok) failedTemporal += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${spec.kind}（案例 ${spec.caseId}）`);
    console.log(`      能杀 ${kills.length} 个：${kills.map((m) => m.id).join(' ') || '—'}`);
    console.log(`      只有它能杀 ${necessary.length} 个：${necessary.join(' ') || '—'}
`);
  }

  const shapeKinds = ['unique', 'type_of', 'subset', 'sorted_by'];

  console.log('形状断言的必要性（案例：两单 + 六条断言）\n');
  console.log('全套变异体：' + pool.length + ' 个，抓到 ' + full.mutations.filter((m) => m.status === 'caught').length + ' 个\n');

  let failed = 0;
  let failedTemporal = 0;
  // 时间窗 / 每步求值：各自一条专用案例，去掉这条断言就该有变异体漏网。
  for (const spec of TEMPORAL) {
    const withIt = await certify({ cases: [fromReal(spec.caseId, [spec.invariant])], adapterFactory: factory, adapterName: 'memory', mutations: pool });
    const without = await certify({ cases: [fromReal(spec.caseId, [])], adapterFactory: factory, adapterName: 'memory', mutations: pool });
    const kills = withIt.mutations.filter((m) => (m.killedBy ?? []).some((k) => (typeof k === 'string' ? k : k.kind) === spec.kind));
    const caughtWith = new Set(withIt.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
    const caughtWithout = new Set(without.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
    const necessary = [...caughtWith].filter((id) => !caughtWithout.has(id));
    const ok = kills.length > 0 && necessary.length > 0;
    if (!ok) failedTemporal += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${spec.kind}（案例 ${spec.caseId}）`);
    console.log(`      能杀 ${kills.length} 个：${kills.map((m) => m.id).join(' ') || '—'}`);
    console.log(`      只有它能杀：${necessary.join(' ') || '—'}`);
  }
  if (failedTemporal > 0) failed += failedTemporal;

  // 分页：单页永远看不出问题，所以要证明「去掉它就有变异体漏网」
  {
    const spec = PAGED;
    const withIt = await certify({ cases: [withGoal(spec.caseId, [...spec.baseline, spec.assertion])], adapterFactory: factory, adapterName: 'memory', mutations: pool });
    const without = await certify({ cases: [withGoal(spec.caseId, [...spec.baseline])], adapterFactory: factory, adapterName: 'memory', mutations: pool });
    const kills = withIt.mutations.filter((m) => (m.killedBy ?? []).some((k) => (typeof k === 'string' ? k : k.kind) === spec.kind));
    const caughtWith = new Set(withIt.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
    const caughtWithout = new Set(without.mutations.filter((m) => m.status === 'caught').map((m) => m.id));
    const necessary = [...caughtWith].filter((id) => !caughtWithout.has(id));
    const ok = kills.length > 0 && necessary.length > 0;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${spec.kind}（案例 ${spec.caseId}）`);
    console.log(`      能杀 ${kills.length} 个：${kills.map((m) => m.id).join(' ') || '—'}`);
    console.log(`      只有它能杀：${necessary.join(' ') || '—'}`);
  }
  for (const kind of shapeKinds) {
    const kills = full.mutations.filter((m) =>
      (m.killedBy ?? []).some((k) => (typeof k === 'string' ? k : k.kind) === kind),
    );
    const necessary = await only(kind);
    const ok = kills.length > 0 && necessary.length > 0;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${kind}`);
    console.log(`      能杀 ${kills.length} 个：${kills.map((m) => m.id).join(' ') || '—'}`);
    console.log(`      只有它能杀：${necessary.join(' ') || '—'}`);
  }

  console.log('\n' + (failed === 0
    ? '形状四种 + 时序两种都换得回东西：去掉任何一条，都有变异体会漏网。'
    : failed + ' 种没有独占战功 —— 按宪法不该进。'));
  return failed === 0 ? 0 : 1;
}

run().then((code) => process.exit(code), (e) => {
  console.error(e?.stack ?? e);
  process.exit(2);
});

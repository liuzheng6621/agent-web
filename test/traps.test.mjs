/**
 * 陷阱普查的自检。
 *
 * 重点不是「函数能跑」，而是「它真的能在判决看起来正常的时候报出盲区」。
 * 每条测试都构造一次假通过，再断言探测器把它指出来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { judge } from '../src/runner.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { TRAPS, scanVerdict, summarizeTraps, trapVerdict, formatTraps } from '../src/traps.mjs';

const foreignPickup = JSON.parse(readFileSync(new URL('../cases/coffee/foreign-pickup.json', import.meta.url), 'utf8'));

function collapsed(inner) {
  return {
    manifest: () => inner.manifest(),
    reset: (o) => inner.reset(o),
    observe: (r, s) => inner.observe(r, s),
    close: (r) => inner.close(r),
    execute: (r, a) => inner.execute(r, { ...a, as: a.as === 'customer2' ? 'customer' : a.as }),
  };
}

function withoutVocabulary(inner) {
  return {
    manifest: async () => {
      const m = await inner.manifest();
      delete m.events_types;
      return m;
    },
    reset: (o) => inner.reset(o),
    observe: (r, s) => inner.observe(r, s),
    close: (r) => inner.close(r),
    execute: (r, a) => inner.execute(r, a),
  };
}

const simpleCase = {
  schema_version: 'agent-web/0.1',
  id: 't/simple',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '下单并进入制作。',
    goal_assertions: [
      { kind: 'field_equals', selector: { collection: 'orders', index: 0 }, path: 'status', value: 'MAKING' },
    ],
  },
  reference_trajectory: [
    { id: 's1', capability: 'order.create', as: 'customer', expected_outcome: 'applied', arguments: { items: [{ dishName: '拿铁', qty: 1 }] } },
    { id: 's2', capability: 'kitchen.accept', as: 'staff', expected_outcome: 'applied', bindings: { orderId: '$s1.orderId' } },
  ],
};

test('identity-collapse：判决 pass 时也能从证据里看出人被执行换了', async () => {
  const buggy = await judge({ case: foreignPickup, adapter: collapsed(createMemoryAdapter()), adapterName: 'collapsed' });
  assert.equal(buggy.status, 'pass', '这个构造必须能骗过判决器，否则测不到东西');

  const rows = scanVerdict(buggy, foreignPickup);
  const hit = rows.find((r) => r.trap === 'identity-collapse');
  assert.equal(hit.state, 'blind');
  assert.match(hit.detail, /customer2/);
  assert.match(hit.detail, /alice/);
});

test('identity-collapse：诚实实现应判为有据可查', async () => {
  const honest = await judge({ case: foreignPickup, adapter: createMemoryAdapter(), adapterName: 'memory' });
  const rows = scanVerdict(honest, foreignPickup);
  assert.equal(rows.find((r) => r.trap === 'identity-collapse').state, 'guarded');
});

test('identity-collapse：只涉及一个角色时不涉及', async () => {
  // simpleCase 用了 customer 和 staff 两个角色，所以它本来就涉及这条陷阱；
  // 要测「不涉及」，得真造一条单角色案例。
  const solo = {
    ...simpleCase,
    id: 't/solo',
    task: { ...simpleCase.task, goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'orders', index: 0 } }] },
    reference_trajectory: [simpleCase.reference_trajectory[0]],
  };
  const v = await judge({ case: solo, adapter: createMemoryAdapter(), adapterName: 'memory' });
  const rows = scanVerdict(v, solo);
  assert.equal(rows.find((r) => r.trap === 'identity-collapse').state, 'absent');
});

test('event-vocabulary：没声明词表时 event_absent 在裸奔', async () => {
  const c = {
    ...simpleCase,
    id: 't/event',
    task: { ...simpleCase.task, invariants: [{ kind: 'event_absent', type: 'order.refunded' }] },
  };
  const naive = await judge({ case: c, adapter: withoutVocabulary(createMemoryAdapter()), adapterName: 'no-vocab' });
  const rows = scanVerdict(naive, c);
  assert.equal(rows.find((r) => r.trap === 'event-vocabulary').state, 'blind');

  const ok = await judge({ case: c, adapter: createMemoryAdapter(), adapterName: 'memory' });
  assert.equal(scanVerdict(ok, c).find((r) => r.trap === 'event-vocabulary').state, 'guarded');
});

test('draft-gate：未确认草稿的判决被认作已守住，确认后不再涉及', async () => {
  const draft = { ...simpleCase, id: 't/draft', draft: { status: 'unconfirmed', generated_by: 'prepare' } };
  const v = await judge({ case: draft, adapter: createMemoryAdapter(), adapterName: 'memory' });
  assert.equal(v.reason_code, 'unconfirmed_draft');
  assert.equal(scanVerdict(v, draft).find((r) => r.trap === 'draft-gate').state, 'guarded');

  const clean = { ...simpleCase, id: 't/clean', draft: { status: 'confirmed', reviewed_by: 'yg' } };
  const v2 = await judge({ case: clean, adapter: createMemoryAdapter(), adapterName: 'memory' });
  assert.equal(scanVerdict(v2, clean).find((r) => r.trap === 'draft-gate').state, 'absent');
});

test('terminal-only：只有终态断言的判决被判盲区，带过程断言则不涉及', async () => {
  const v = await judge({ case: simpleCase, adapter: createMemoryAdapter(), adapterName: 'memory' });
  assert.equal(scanVerdict(v, simpleCase).find((r) => r.trap === 'terminal-only').state, 'blind');

  const withTrace = {
    ...simpleCase,
    id: 't/trace',
    task: {
      ...simpleCase.task,
      goal_assertions: [
        ...simpleCase.task.goal_assertions,
        { kind: 'status_transition', selector: { collection: 'orders', index: 0 }, from: 'PENDING', to: 'MAKING' },
      ],
    },
  };
  const v2 = await judge({ case: withTrace, adapter: createMemoryAdapter(), adapterName: 'memory' });
  assert.equal(scanVerdict(v2, withTrace).find((r) => r.trap === 'terminal-only').state, 'absent');
});

test('环境故障的判决算作废，不算盲区也不算守住', async () => {
  const bad = { ...simpleCase, id: 't/bad' };
  const v = await judge({
    case: bad,
    adapter: { manifest: async () => { throw new Error('boom'); }, reset: async () => ({}), observe: async () => ({}), close: async () => {}, execute: async () => ({}) },
    adapterName: 'broken',
  });
  assert.equal(v.reason_code, 'infrastructure_error');
  const rows = scanVerdict(v, bad);
  assert.ok(rows.every((r) => r.state === 'unusable'));
});

test('汇总与门槛：盲区率按「涉及的风险点」算，不是按案例数', async () => {
  const v1 = await judge({ case: simpleCase, adapter: createMemoryAdapter(), adapterName: 'memory' });
  const report = summarizeTraps([{ verdict: v1, case: simpleCase }]);
  assert.equal(report.total, 1);
  // simpleCase 同时踩两个坑：身份塌缩（守住了）+ 只看终态（盲区）。
  // 分母是风险点而不是案例数，所以这里是 2，不是 1——一局可能同时踩多个坑。
  assert.equal(report.applicable_total, 2);
  assert.equal(report.blind_total, 1);
  assert.equal(report.blind_rate, 0.5);
  assert.equal(trapVerdict(report, { maxBlind: 0 }).ok, false);
  assert.equal(trapVerdict(report, { maxBlind: 1 }).ok, true);
  assert.match(formatTraps(report), /盲区率/);
});

test('四条陷阱都有出处与问题，不多不少', () => {
  assert.deepEqual(TRAPS.map((t) => t.id), ['identity-collapse', 'event-vocabulary', 'draft-gate', 'terminal-only']);
  for (const t of TRAPS) assert.ok(t.question && t.title && t.exhibit);
});

/**
 * 契约外的 outcome 必须被判 unknown，而不是悄悄滑过去。
 *
 * 这个测试存在的理由：它是唯一一种「适配器没撒谎、断言没写错、环境没坏」
 * 的假通过。四个分类分支都不命中时不会报错——不报错本身就是 bug。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge } from '../src/runner.mjs';
import { probeAdapter } from '../src/probe.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { OUTCOMES } from '../src/adapter/contract.mjs';

const CASE = {
  schema_version: 'agent-web/0.1',
  id: 'contract/off-outcome',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '下一单',
    goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'orders' } }],
  },
  reference_trajectory: [
    {
      id: 's1',
      capability: 'order.create',
      as: 'customer',
      expected_outcome: 'applied',
      arguments: { items: [{ dishName: '拿铁', qty: 1 }] },
    },
  ],
  observability: { declared_scopes: ['orders', 'menu'] },
};

function withOutcome(outcome) {
  const inner = createMemoryAdapter();
  return {
    ...inner,
    async execute(runId, action) {
      const res = await inner.execute(runId, action);
      return { ...res, outcome };
    },
  };
}

test('契约说四选一：OUTCOMES 是封闭枚举，顺序固定', () => {
  assert.deepEqual([...OUTCOMES], ['applied', 'rejected', 'unsupported', 'infra_error']);
});

test('契约外的 outcome 判 unknown / contract_violation（不是 pass）', async () => {
  for (const bogus of ['success', 'ok', 'applied ', 'APPLIED', 'done', '', null, undefined]) {
    const v = await judge({ case: CASE, adapter: withOutcome(bogus), adapterName: 'memory' });
    assert.equal(v.status, 'unknown', `outcome=${JSON.stringify(bogus)} 被判成了 ${v.status}`);
    assert.equal(v.reason_code, 'contract_violation', `outcome=${JSON.stringify(bogus)}`);
  }
});

test('白名单内的值照旧：unsupported 判 coverage_gap，applied 判 pass', async () => {
  const unsupported = await judge({ case: CASE, adapter: withOutcome('unsupported'), adapterName: 'memory' });
  assert.equal(unsupported.status, 'unknown');
  assert.equal(unsupported.reason_code, 'coverage_gap');

  const applied = await judge({ case: CASE, adapter: withOutcome('applied'), adapterName: 'memory' });
  assert.equal(applied.status, 'pass');
});

test('细节里必须写清「只认哪几个」，否则读者无法据此行动', async () => {
  const v = await judge({ case: CASE, adapter: withOutcome('success'), adapterName: 'memory' });
  for (const o of OUTCOMES) assert.ok(v.detail.includes(o), `detail 里没提 ${o}`);
  assert.ok(v.detail.includes('success'), 'detail 里没提实际收到的值');
});

test('probe 第 6 项独立报警：即使 runner 的白名单被改回去也能查出来', async () => {
  const p = await probeAdapter({ adapter: withOutcome('ok'), adapterName: 'memory' });
  const check = p.checks.find((c) => c.id === 'outcome-contract');
  assert.ok(check, 'probe 缺 outcome-contract 检查项');
  assert.equal(check.status, 'fail');
  assert.ok(p.summary.total >= 10, '探针项数应该从 9 增到 10');
});

test('诚实适配器在 probe 上这一项必须过', async () => {
  const p = await probeAdapter({ adapter: createMemoryAdapter(), adapterName: 'memory' });
  const check = p.checks.find((c) => c.id === 'outcome-contract');
  assert.equal(check.status, 'pass');
});

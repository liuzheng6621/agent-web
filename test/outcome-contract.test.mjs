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
import { OUTCOMES, UNCERTAIN_OUTCOMES } from '../src/adapter/contract.mjs';

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

function withOutcome(outcome, error) {
  const inner = createMemoryAdapter();
  return {
    ...inner,
    async execute(runId, action) {
      const res = await inner.execute(runId, action);
      return error ? { ...res, outcome, error } : { ...res, outcome };
    },
  };
}

test('契约说五选一：OUTCOMES 是封闭枚举，顺序固定', () => {
  assert.deepEqual([...OUTCOMES], [
    'applied', 'rejected', 'unsupported', 'infra_error', 'may_have_committed',
  ]);
  assert.deepEqual([...UNCERTAIN_OUTCOMES], ['may_have_committed']);
});

test('契约外的 outcome 判 unknown / contract_violation（不是 pass）', async () => {
  for (const bogus of ['success', 'ok', 'applied ', 'APPLIED', 'done', '', null, undefined]) {
    const v = await judge({ case: CASE, adapter: withOutcome(bogus), adapterName: 'memory' });
    assert.equal(v.status, 'unknown', `outcome=${JSON.stringify(bogus)} 被判成了 ${v.status}`);
    assert.equal(v.reason_code, 'contract_violation', `outcome=${JSON.stringify(bogus)}`);
  }
});

test('may_have_committed 判 unknown / effect_uncertain，且与 infra_error 分开', async () => {
  const uncertain = await judge({
    case: CASE,
    adapter: withOutcome('may_have_committed', { code: 'ETIMEDOUT', message: '请求超时' }),
    adapterName: 'memory',
  });
  assert.equal(uncertain.status, 'unknown');
  assert.equal(uncertain.reason_code, 'effect_uncertain',
    'infra_error 说「可以重试」，effect_uncertain 说「不许重试」—— 合成一个码，重放器只能猜');
  assert.ok(uncertain.detail.includes('ETIMEDOUT'), 'detail 里要留原因，否则没人能据此行动');
  assert.ok(uncertain.detail.includes('不许重放'), 'detail 里要写明重放策略');

  const infra = await judge({
    case: CASE, adapter: withOutcome('infra_error'), adapterName: 'memory',
  });
  assert.equal(infra.reason_code, 'infrastructure_error');
  assert.notEqual(uncertain.reason_code, infra.reason_code);
});

test('may_have_committed 时不许继续往下执行：后续步骤一次都不能跑', async () => {
  const inner = createMemoryAdapter();
  let calls = 0;
  const guarded = {
    ...inner,
    async execute(runId, action) {
      calls += 1;
      if (action.capability === 'order.create') {
        return { outcome: 'may_have_committed', error: { code: 'ECONNRESET', message: '连接断在响应前' } };
      }
      return inner.execute(runId, action);
    },
  };
  const twoStep = {
    ...CASE,
    id: 'contract/mhc-stops',
    reference_trajectory: [
      CASE.reference_trajectory[0],
      { id: 's2', capability: 'order.cancel', as: 'customer', expected_outcome: 'applied',
        arguments: { orderId: '$s1.orderId' } },
    ],
  };
  const v = await judge({ case: twoStep, adapter: guarded, adapterName: 'memory' });
  assert.equal(v.reason_code, 'effect_uncertain');
  assert.equal(calls, 1, '第一步结果不确定之后，第二步不该再跑 —— 那会拿一个不存在的 orderId 去取消');
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

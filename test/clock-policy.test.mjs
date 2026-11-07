import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_POLICIES, DEFAULT_CLOCK_POLICY, validateManifest } from '../src/adapter/contract.mjs';
import { validateCase } from '../src/case.mjs';
import { judge } from '../src/runner.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { probeAdapter } from '../src/probe.mjs';

const BASE_CASE = {
  schema_version: 'agent-web/0.1',
  id: 'clock/test',
  task: {
    natural_goal: '读一次菜单',
    goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'menu' } }],
  },
  reference_trajectory: [
    { id: 's1', capability: 'menu.list', as: 'customer', expected_outcome: 'applied' },
  ],
};

function caseWith(environment) {
  return { ...BASE_CASE, environment: { adapter: 'memory', ...environment } };
}

/** 把内层适配器的 manifest 换掉，其余原样转发。 */
function withManifest(inner, patch) {
  return {
    ...inner,
    async manifest() { return { ...(await inner.manifest()), ...patch }; },
  };
}

test('时钟策略是封闭枚举，默认值是 wall', () => {
  assert.deepEqual([...CLOCK_POLICIES], ['frozen', 'wall']);
  assert.equal(DEFAULT_CLOCK_POLICY, 'wall');
});

test('manifest 声明了非法的 clock_policies 会被拒', () => {
  const bad = { adapter: 'x', adapter_version: '1', reset_strategy: 'snapshot', scopes: ['a'], capabilities: [{ id: 'c', kind: 'read', evidence_level: 'observed' }], clock_policies: ['stopped'] };
  const errs = validateManifest(bad);
  assert.ok(errs.some((e) => e.includes('clock_policies') && e.includes('stopped')), errs.join('；'));
  const empty = { ...bad, clock_policies: [] };
  assert.ok(validateManifest(empty).some((e) => e.includes('clock_policies')));
  const ok = { ...bad, clock_policies: ['frozen'] };
  assert.deepEqual(validateManifest(ok), []);
});

test('案例写错 clock_policy 是 invalid_case，不是默默按默认值跑', () => {
  const errs = validateCase(caseWith({ clock_policy: 'FROZEN' }));
  assert.ok(errs.some((e) => e.includes('clock_policy') && e.includes('frozen/wall')), errs.join('；'));
});

test('案例 environment 里出现不认识的键就报错（幽灵字段不能再溜进来）', () => {
  const errs = validateCase(caseWith({ reset_strategy: 'identity' }));
  assert.ok(errs.some((e) => e.includes('environment.reset_strategy') && e.includes('不是环境项')), errs.join('；'));
});

test('案例要 frozen 但适配器只支持 wall → unknown/invalid_environment', async () => {
  const inner = createMemoryAdapter();
  const v = await judge({
    case: caseWith({ clock_policy: 'frozen' }),
    adapter: withManifest(inner, { clock_policies: ['wall'] }),
  });
  assert.equal(v.status, 'unknown');
  assert.equal(v.reason_code, 'invalid_environment');
  assert.match(v.detail, /案例要求时钟 frozen/);
  assert.match(v.detail, /只支持 wall/);
});

test('两边都是 frozen 就正常放行，并把实际策略写进判决', async () => {
  const v = await judge({ case: caseWith({ clock_policy: 'frozen' }), adapter: createMemoryAdapter() });
  assert.equal(v.status, 'pass');
  assert.equal(v.clock_policy, 'frozen');
});

test('不声明时钟策略的案例按 wall 记，且不因适配器不支持 frozen 而红', async () => {
  const v = await judge({ case: caseWith({}), adapter: createMemoryAdapter() });
  assert.equal(v.status, 'pass');
  assert.equal(v.clock_policy, 'wall');
});

test('探针里有一项专门查「声明 frozen 的适配器时钟真的冻住」', async () => {
  const report = await probeAdapter({ adapter: createMemoryAdapter(), adapterName: 'memory' });
  const c = report.checks.find((x) => x.id === 'clock-honest');
  assert.ok(c, '探针里没有 clock-honest 这一项');
  assert.equal(c.status, 'pass');
  // 措辞里必须写明这条检查的局限：指纹相同不等于时间被冻结
  assert.match(c.detail, /不证明时间真的被冻结/);
});

test('适配器没声明 frozen 时这一项跳过，而不是假装通过', async () => {
  const inner = createMemoryAdapter();
  const report = await probeAdapter({ adapter: withManifest(inner, { clock_policies: ['wall'] }), adapterName: 'x' });
  const c = report.checks.find((x) => x.id === 'clock-honest');
  assert.equal(c.status, 'skipped');
  assert.match(c.detail, /没声明 frozen/);
});

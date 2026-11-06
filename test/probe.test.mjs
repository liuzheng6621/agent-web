import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { probeAdapter, probeExit, PROBE_VERSION } from '../src/probe.mjs';

test('探针：内置适配器应当自洽', async () => {
  const adapter = createMemoryAdapter();
  const r = await probeAdapter({ adapter });
  assert.equal(r.probe_version, PROBE_VERSION);
  assert.equal(r.summary.failed, 0);
  assert.ok(r.summary.total >= 5);
  assert.equal(probeExit(r), 0);
});

test('探针：复位不复位（上一轮数据还在）必须判死', async () => {
  // 一份手写的最小适配器：reset 换了 runId，但底层库里上一轮的订单没清
  const shared = [];
  let seq = 0;
  const leaky = {
    manifest: async () => ({
      adapter: 'leaky',
      adapter_version: '0.0.1',
      reset_strategy: 'snapshot',
      canonical_view: 'agent-web/canonical-view',
      description: '故意不复位干净',
      scopes: ['orders'],
      roles: ['customer'],
      capabilities: [
        { id: 'order.create', kind: 'write', evidence_level: 'validated', roles: ['customer'] },
        { id: 'order.list', kind: 'read', evidence_level: 'validated', roles: ['customer'] },
      ],
    }),
    reset: async () => ({ runId: 'run-' + ++seq, roleBindings: { customer: 'u1' } }),
    // 关键：不按 runId 分区，写进去的东西留在了共享库里
    observe: async () => ({ state: { orders: shared.map((o) => ({ ...o })), menu: [], status_log: [] } }),
    execute: async () => {
      shared.push({ id: 1000 + shared.length, status: 'PENDING' });
      return { outcome: 'applied', payload: { orderId: 1000 + shared.length } };
    },
    close: async () => {},
  };
  const r = await probeAdapter({ adapter: leaky });
  const leak = r.checks.find((c) => c.id === 'no-leak');
  assert.equal(leak.status, 'fail');
  assert.match(leak.detail, /这一轮的残留会流进下一轮案例/);
  assert.equal(probeExit(r), 1);
});

test('探针：视图里混进时钟，观测不稳定必须判死', async () => {
  const inner = createMemoryAdapter();
  let tick = 0;
  const adapter = {
    manifest: () => inner.manifest(),
    reset: (o) => inner.reset(o),
    execute: (a, b) => inner.execute(a, b),
    close: (a) => inner.close(a),
    async observe(runId) {
      const r = await inner.observe(runId);
      // 每次读都变一点：这正是「视图里混进时钟」的样子
      return { ...r, state: { ...r.state, cursor: ++tick } };
    },
  };
  const r = await probeAdapter({ adapter });
  const stable = r.checks.find((c) => c.id === 'observe-stable');
  assert.equal(stable.status, 'fail');
  assert.match(stable.detail, /连读两次不一致/);
  assert.equal(probeExit(r), 1);
});

test('探针：调用方声明视图含时钟时可跳过稳定性检查', async () => {
  const inner = createMemoryAdapter();
  let tick = 0;
  const adapter = {
    manifest: () => inner.manifest(),
    reset: (o) => inner.reset(o),
    execute: (a, b) => inner.execute(a, b),
    close: (a) => inner.close(a),
    async observe(runId) {
      const r = await inner.observe(runId);
      return { ...r, state: { ...r.state, cursor: ++tick } };
    },
  };
  const r = await probeAdapter({ adapter, allowVolatile: true });
  const skipped = r.checks.find((c) => c.id === 'volatile');
  assert.equal(skipped.status, 'skipped');
  assert.equal(r.checks.some((c) => c.id === 'observe-stable'), false);
});

test('探针：写了声明成功但视图毫无变化只报警不判死', async () => {
  const inner = createMemoryAdapter();
  const adapter = {
    manifest: () => inner.manifest(),
    reset: (o) => inner.reset(o),
    close: (a) => inner.close(a),
    observe: (runId) => inner.observe(runId),
    async execute(runId, action) {
      const r = await inner.execute(runId, action);
      // 假执行：什么都不做，但声称成功。
      // 只对合法角色假成功——否则会顺带制造「角色被绕过」的第二处谎，
      // 那条由 role-effective 抓，不该混进这条测试的结论里。
      if (action.capability === 'order.create' && action.as === 'customer') {
        return { outcome: 'applied', payload: { orderId: 1 } };
      }
      return r;
    },
  };
  const r = await probeAdapter({ adapter });
  const w = r.checks.find((c) => c.id === 'write-visible');
  assert.ok(w, '应当报出 write-visible');
  assert.equal(w.status, 'warn');
  // 报警不改变总体结论
  assert.equal(r.summary.warned >= 1, true);
  assert.equal(r.summary.failed, 0);
});

test('探针：能力用空参数调用不得抛异常', async () => {
  const inner = createMemoryAdapter();
  const adapter = {
    manifest: () => inner.manifest(),
    reset: (o) => inner.reset(o),
    observe: (runId) => inner.observe(runId),
    close: (a) => inner.close(a),
    async execute() {
      throw new Error('boom');
    },
  };
  const r = await probeAdapter({ adapter });
  const c = r.checks.find((x) => x.id === 'empty-args');
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /boom/);
  assert.equal(probeExit(r), 1);
});

test('探针：manifest 不合法时立刻停，不去跑后面的检查', async () => {
  const adapter = {
    manifest: async () => ({ adapter: 'x' }),
    reset: async () => ({ runId: 'r1' }),
    observe: async () => ({ state: {} }),
    execute: async () => ({ outcome: 'rejected' }),
    close: async () => {},
  };
  const r = await probeAdapter({ adapter });
  assert.equal(r.summary.failed >= 1, true);
  assert.equal(r.checks.some((c) => c.id === 'manifest'), true);
  assert.equal(r.checks.some((c) => c.id === 'reset-idempotent'), false);
});


test('探针：声明了却不存在的能力必须被抓', async () => {
  const { createAdapter } = await import('./fixtures/lying-adapter.mjs');
  const r = await probeAdapter({ adapter: createAdapter() });
  const c = r.checks.find((x) => x.id === 'declared-vs-behavior');
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /note\.vanish/);
});

test('探针：忽略角色的适配器必须被抓', async () => {
  const { createAdapter } = await import('./fixtures/lying-adapter.mjs');
  const r = await probeAdapter({ adapter: createAdapter() });
  const c = r.checks.find((x) => x.id === 'role-effective');
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /note\.create/);
});

test('探针：读偷偷写必须被抓', async () => {
  const { createAdapter } = await import('./fixtures/lying-adapter.mjs');
  const r = await probeAdapter({ adapter: createAdapter() });
  const c = r.checks.find((x) => x.id === 'read-no-side-effect');
  assert.equal(c.status, 'fail');
  assert.match(c.detail, /note\.list/);
});

test('探针：内置适配器九项全过', async () => {
  const { createMemoryAdapter } = await import('../src/adapter/memory.mjs');
  const r = await probeAdapter({ adapter: createMemoryAdapter() });
  assert.equal(r.summary.failed, 0);
  for (const id of ['declared-vs-behavior', 'role-effective', 'read-no-side-effect']) {
    assert.ok(r.checks.some((c) => c.id === id), `缺检查项 ${id}`);
  }
});

test('探针：每条能力各挑自己的局外人（角色集合不同不许诬告）', async () => {
  // 诚实实现：admin.purge 只准 admin，public.post 准 anonymous+member。
  // 拿 admin.purge 挑出的 anonymous 去打 public.post，会把诚实实现判成越权。
  const { createAdapter } = await import('./fixtures/mixed-roles-adapter.mjs');
  const r = await probeAdapter({ adapter: createAdapter() });
  const c = r.checks.find((x) => x.id === 'role-effective');
  assert.equal(c.status, 'pass', c.detail);
  assert.match(c.detail, /admin\.purge\(forbidden\)/);
  assert.match(c.detail, /public\.post\(forbidden\)/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCase } from '../src/case.mjs';
import { loadAdapter } from '../src/adapter/load.mjs';

const dir = new URL('../cases/cron/', import.meta.url);
const files = ['recurrence-full.json', 'recurrence-gap.json', 'recurrence-drift.json'];
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

test('三条案例都通过校验，且 id 与文件名对得上', () => {
  for (const f of files) {
    const c = load(f);
    const errors = validateCase(c);
    assert.deepEqual(errors, [], `${f}: ${errors.join('; ')}`);
    assert.equal(c.id, `cron/${f.replace('.json', '')}`);
  }
});

test('expected.json 的键与案例一一对应，且全标 pass', () => {
  const exp = load('expected.json');
  assert.deepEqual(Object.keys(exp).sort(), files.map((f) => `cron/${f.replace('.json', '')}`).sort());
  for (const [k, v] of Object.entries(exp)) assert.equal(v, 'pass', k);
});

test('每步能力都在 manifest 声明过（否则跑起来是 coverage_gap）', async () => {
  const a = await loadAdapter('cron-a');
  const m = await a.manifest();
  const ids = new Set(m.capabilities.map((c) => c.id));
  for (const f of files) {
    for (const s of load(f).reference_trajectory) {
      assert.ok(ids.has(s.capability), `${f}: ${s.capability} 未声明`);
    }
  }
});

test('两个实现的 manifest 视图契约逐字相同（否则同一份案例不可比）', async () => {
  const a = await (await loadAdapter('cron-a')).manifest();
  const b = await (await loadAdapter('cron-b')).manifest();
  assert.equal(a.view.version, b.view.version);
  assert.deepEqual(Object.keys(a.view.collections).sort(), Object.keys(b.view.collections).sort());
  for (const k of Object.keys(a.view.collections)) {
    assert.deepEqual(a.view.collections[k].required, b.view.collections[k].required, k);
  }
});

test('events_complete 必须是 false：runs 就是观察，没有独立事件流', async () => {
  for (const id of ['cron-a', 'cron-b']) {
    const m = await (await loadAdapter(id)).manifest();
    assert.equal(m.events_complete, false, `${id} 谎称事件记录完整会让 event_absent 判假`);
  }
});

test('角色分组：advance/pause/resume/create 是 operator，读能力两个角色都能用', async () => {
  const m = await (await loadAdapter('cron-a')).manifest();
  const byId = new Map(m.capabilities.map((c) => [c.id, c]));
  for (const id of ['job.create', 'scheduler.advance', 'job.pause', 'job.resume']) {
    assert.deepEqual(byId.get(id).roles, ['operator'], id);
  }
  assert.deepEqual(byId.get('jobs.list').roles, ['operator', 'viewer']);
  assert.deepEqual(byId.get('runs.list').roles, ['operator', 'viewer']);
});

test('recurrence 断言在三条案例里都真的出现了', () => {
  const kinds = (f) => load(f).task.goal_assertions.map((a) => a.kind);
  assert.ok(kinds('recurrence-full.json').includes('recurrence'));
  assert.equal(kinds('recurrence-gap.json').filter((k) => k === 'recurrence').length, 2, '暂停被切成两段');
  assert.ok(kinds('recurrence-drift.json').includes('recurrence'));
  const drift = load('recurrence-drift.json').task.goal_assertions.find((a) => a.kind === 'recurrence');
  assert.equal(drift.tolerance_ms, 60000, '容差必须显式写出来，不能靠实现偷偷放宽');
});

test('漂移案例必须带 unique：光有节律不足以说明「没有跑两次」', () => {
  const kinds = load('recurrence-drift.json').task.goal_assertions.map((a) => a.kind);
  assert.ok(kinds.includes('unique'));
});

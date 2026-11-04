import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { certify, certifyExit, probe, flatAssertions } from '../src/certify.mjs';
import { MUTATIONS, mutate, mutationIds } from '../src/mutate.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';

const DIR = 'cases/coffee';
const all = () => readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'expected.json')
  .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')))
  .sort((a, b) => a.id.localeCompare(b.id));

const happy = () => all().find((c) => c.id === 'coffee/happy-path');

test('变异体清单稳定：六个，id 不重复', () => {
  const ids = mutationIds();
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6);
  for (const m of MUTATIONS) {
    assert.equal(typeof m.wrap, 'function', `${m.id} 缺 wrap`);
    assert.ok(['state', 'execute'].includes(m.level), `${m.id} level 不对`);
  }
});

test('金额变异真的改了被观测到的总额', async () => {
  const c = happy();
  const base = await probe(c, createMemoryAdapter(), { adapterName: 'memory' });
  const bad = await probe(c, mutate(createMemoryAdapter(), 'm-money-off-by-cent'), { adapterName: 'memory' });
  const b = base.verdict.evidence.final.orders[0].totalAmount;
  const m = bad.verdict.evidence.final.orders[0].totalAmount;
  assert.notEqual(b, m, '变异体没有改动金额，那它测不出任何东西');
});

test('缺了金额与流水断言的案例，会漏掉两个变异体', async () => {
  const c = happy();
  const stripped = JSON.parse(JSON.stringify(c));
  stripped.task.goal_assertions = stripped.task.goal_assertions.filter((a) => a.path !== 'totalAmount');
  stripped.task.invariants = stripped.task.invariants.filter((a) => a.selector?.collection !== 'status_log');

  const report = await certify({
    cases: [stripped],
    adapterFactory: () => createMemoryAdapter(),
    adapterName: 'memory',
  });
  const survived = report.mutations.filter((m) => !m.caught).map((m) => m.id);
  assert.ok(survived.includes('m-money-off-by-cent'), `期望漏掉金额变异，实际漏网 ${survived.join(',')}`);
  assert.ok(survived.includes('m-history-empty'), `期望漏掉流水变异，实际漏网 ${survived.join(',')}`);
  assert.equal(certifyExit(report), 1, '有漏网变异体时必须判红');
});

test('补齐断言后同一批变异体全被抓到', async () => {
  const report = await certify({
    cases: all(),
    adapterFactory: () => createMemoryAdapter(),
    adapterName: 'memory',
  });
  assert.equal(report.summary.survived, 0, `仍有漏网：${report.mutations.filter((m) => !m.caught).map((m) => m.id).join(',')}`);
  assert.equal(report.summary.caught, report.summary.mutations);
  assert.equal(certifyExit(report), 0);
});

test('最小充分集覆盖所有被断言抓到的变异体', async () => {
  const report = await certify({ cases: all(), adapterFactory: () => createMemoryAdapter() });
  // 只靠负例步（判决级）抓到的变异体不在断言覆盖范围内 —— 它们的守卫是步的 expected_outcome。
  const caught = report.mutations.filter((m) => m.killedBy.length > 0).map((m) => m.id);
  for (const id of caught) {
    const covered = report.minimal.covers.includes(id) || report.minimal.uncovered.includes(id);
    assert.ok(covered, `${id} 既不在 covers 也不在 uncovered`);
  }
  assert.deepEqual(report.minimal.uncovered, [], '有变异体抓到了却没被最小集覆盖');
  assert.ok(report.minimal.assertions.length <= caught.length, '最小集不该比被覆盖的变异体还多');
});

test('空转断言被点名，且 --strict 会因此判红', async () => {
  const report = await certify({ cases: all(), adapterFactory: () => createMemoryAdapter() });
  const dead = report.assertions.filter((a) => !a.unarmed && a.kills.length === 0);
  assert.ok(dead.length > 0, '当前案例集应当存在抓不住任何东西的断言');
  for (const a of dead) assert.equal(a.kills.length, 0);
  assert.equal(certifyExit(report), 0, '默认不因空转断言判红');
  assert.equal(certifyExit(report, { strict: true }), 1, '--strict 下空转断言必须判红');
});

test('在正确实现上不为真的断言不参与准入统计', async () => {
  const report = await certify({ cases: all(), adapterFactory: () => createMemoryAdapter() });
  const unarmed = report.assertions.filter((a) => a.unarmed);
  assert.ok(unarmed.length > 0, '本案例集里有故意失败的见证案例，应当出现 unarmed 断言');
  for (const a of unarmed) {
    assert.deepEqual(a.kills, []);
    assert.deepEqual(a.blind, []);
  }
});

test('flatAssertions 把 goal 与 invariant 分成两组标号', () => {
  const list = flatAssertions(happy());
  assert.ok(list.some((x) => x.label === 'goal[0]'));
  assert.ok(list.some((x) => x.label === 'inv[0]'));
  assert.equal(list.length, happy().task.goal_assertions.length + (happy().task.invariants ?? []).length);
});

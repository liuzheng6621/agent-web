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

test('变异体清单稳定：登记数与导出数一致，id 不重复', () => {
  const ids = mutationIds();
  assert.ok(ids.length >= 12, `变异体目录只剩 ${ids.length} 个，扩题后被删了？`);
  assert.equal(new Set(ids).size, ids.length, 'id 有重复');
  for (const m of MUTATIONS) {
    assert.equal(typeof m.wrap, 'function', `${m.id} 缺 wrap`);
    assert.ok(['state', 'execute'].includes(m.layer), `${m.id} layer 不对`);
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

test('补齐断言后，金额与流水这两个变异体必须被抓回来', async () => {
  // 案例集当前仍抓不住四个观测层的新变异体（见 scripts/certify-baseline.mjs），
  // 但金额少一分、流水被吞这两个是补过断言的，不许再漏。
  const report = await certify({
    cases: all(),
    adapterFactory: () => createMemoryAdapter(),
    adapterName: 'memory',
  });
  const byId = new Map(report.mutations.map((m) => [m.id, m]));
  for (const id of ['m-money-off-by-cent', 'm-history-empty']) {
    assert.ok(byId.get(id).caught, `${id} 又漏了：对应断言被删了？`);
  }
  assert.equal(report.summary.caught + report.summary.survived, report.summary.mutations);
  assert.equal(certifyExit(report), report.summary.survived > 0 ? 1 : 0);
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
  // 当前有漏网变异体，所以默认退出码就是 1（漏网优先于空转）
  assert.equal(certifyExit(report), 1);
  // 把漏网抹掉，才能单独看「空转」这一项自己的作用：默认放行、--strict 判红
  const clean = { ...report, summary: { ...report.summary, survived: 0 } };
  assert.equal(certifyExit(clean), 0, '默认不该因空转断言判红');
  assert.equal(certifyExit(clean, { strict: true }), 1, '--strict 下空转断言必须判红');
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

test('变异体目录：登记名与 meta.id 必须一致，字段齐全', async () => {
  const { validateMutants, mutants } = await import('../docs/mutants/index.mjs');
  assert.equal(validateMutants([['m-x', { meta: { id: 'm-x', title: 't', layer: 'state', symptom: 's', mechanism: 'm', catch_hint: 'c' }, wrap() {} }]]).length, 0);
  assert.ok(mutants.length >= 6);
  for (const m of mutants) {
    assert.ok(m.title && m.symptom && m.mechanism && m.catch_hint, `${m.id} 少了说明字段`);
    assert.ok(['state', 'execute'].includes(m.layer), `${m.id} layer 不对`);
  }
});

test('变异体目录会拒收坏投稿', async () => {
  const { validateMutants } = await import('../docs/mutants/index.mjs');
  const ok = { id: 'm-ok', title: 't', layer: 'state', symptom: 's', mechanism: 'm', catch_hint: 'c' };
  const bad = (patch) => validateMutants([['m-ok', { meta: { ...ok, ...patch }, wrap() {} }]]);

  assert.ok(bad({ id: 'm-other' }).some((e) => e.includes('与登记名不符')), '复制粘贴没改 id 必须被拒');
  assert.ok(bad({ id: 'M_BAD' }).some((e) => e.includes('m-some-thing')), 'id 形状不对必须被拒');
  assert.ok(bad({ layer: 'observe' }).some((e) => e.includes('layer')), 'layer 只能是 state/execute');
  assert.ok(bad({ catch_hint: '' }).some((e) => e.includes('catch_hint')), '写不出怎么抓的必须被拒');
  assert.ok(validateMutants([['m-ok', { meta: ok }]]).some((e) => e.includes('wrap')), '没有 wrap 必须被拒');
  const dup = validateMutants([
    ['m-ok', { meta: ok, wrap() {} }],
    ['m-ok', { meta: ok, wrap() {} }],
  ]);
  assert.ok(dup.some((e) => e.includes('重复')), '重复 id 必须被拒');
});

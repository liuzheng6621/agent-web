import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  certify,
  certifyExit,
  probe,
  flatAssertions,
  diffLeaves,
  suggestFromWitness,
  verifySuggestion,
  formatSuggestions,
  isPortablePath,
  appliesTo,
} from '../src/certify.mjs';
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
  // timeliness 也读 status_log：留着它，删掉流水就变成 unknown 而不是漏网，
  // 这条测试的立论（「没有流水断言就会漏掉流水变异」）就不成立了。
  stripped.task.goal_assertions = stripped.task.goal_assertions.filter((a) => a.kind !== 'timeliness');

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
  assert.equal(report.summary.caught + report.summary.survived + report.summary.notApplicable, report.summary.mutations);
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

test('差异摊平：把两棵视图的每个不同叶子都报出来', () => {
  const a = { orders: [{ id: 1, totalAmount: 56, items: [{ count: 2 }] }] };
  const b = { orders: [{ id: 1, totalAmount: 28, items: [{ count: 1 }] }] };
  const d = diffLeaves(a, b);
  const paths = d.map((x) => x.path).sort();
  assert.deepEqual(paths, ['orders.0.items.0.count', 'orders.0.totalAmount']);
  assert.equal(d.find((x) => x.path === 'orders.0.totalAmount').correct, 56);
});

test('差异翻断言：字段用 field_equals，长度用 count_delta，认不出的不猜', () => {
  const ctx = { initial: { orders: [] }, final: { orders: [{}, {}] } };
  const len = suggestFromWitness({ path: 'orders.length', correct: 2 }, ctx);
  assert.deepEqual(len, { kind: 'count_delta', selector: { collection: 'orders' }, delta: 2 });

  const field = suggestFromWitness({ path: 'orders.0.items.0.count', correct: 2 }, ctx);
  assert.deepEqual(field, {
    kind: 'field_equals',
    selector: { collection: 'orders', index: 0 },
    path: 'items.0.count',
    value: 2,
  });

  assert.equal(suggestFromWitness({ path: 'some_unknown_thing', correct: 1 }, ctx), null);
  assert.equal(suggestFromWitness({ path: 'orders.0', correct: {} }, ctx), null, '整个实体不同不该硬翻成一条字段断言');
});

test('建议断言必须当场验过才允许出现；给不出的必须说明卡在哪', async () => {
  const report = await certify({ cases: all(), adapterFactory: () => createMemoryAdapter() });
  const uncaught = report.mutations.filter((m) => !m.caught && m.status !== 'not_applicable');
  assert.ok(uncaught.length > 0);
  // 适用范围机制上线后，跨域变异体会被单独归为 not_applicable，不该混进欠账
  const na = report.mutations.filter((m) => m.status === 'not_applicable');
  assert.equal(report.summary.notApplicable, na.length, 'notApplicable 计数与实际一致');
  for (const m of uncaught) {
    assert.equal(m.status, 'killable', `${m.id} 没有可观测差异，应当是 undetermined 而不是静默算进欠账`);
    if (m.suggestion) {
      assert.equal(m.suggestion.proof.onBase, 'true', `${m.id} 的建议断言在正确实现上不成立`);
      assert.equal(m.suggestion.proof.onMutant, 'false', `${m.id} 的建议断言杀不掉它`);
    } else {
      // 给不出建议是允许的，但必须说清是「差异全落在不可移植字段上」，
      // 不能什么都不说 —— 沉默会被读成「工具没找到洞」。
      assert.equal(m.suggestionBlocked, true, `${m.id} 既没有建议也没有说是被不可移植字段挡住的`);
      assert.ok(m.witness, `${m.id} 连见证都没有，那就不该是 killable`);
    }
  }
});

test('适用范围：声明了能力或集合的变异体，在别的域里不算漏网', async () => {
  // m-ledger-sign-flip 只认 trial 集合。memory 适配器没有 trial，所以它是不适用，
  // 而不是「漏网」——把跨域变异体混进分母，会让每个新域都把抓获率砸出个大坑。
  const coffee = await certify({ cases: all(), adapterFactory: () => createMemoryAdapter() });
  const na = coffee.mutations.filter((m) => m.status === 'not_applicable');
  // 账本变异体有几个就写几个，但**不能少于三个**：这条测的是「跨域不进分母」，
  // 不是某个具体条数。硬编条数会让每加一个业务变异体都要改测试。
  assert.ok(na.length >= 3, '账本变异体在咖啡域应全部不适用：' + na.map((m) => m.id).join(','));
  for (const id of ['m-ledger-sign-flip', 'm-dup-credit-entry', 'm-unbalanced-accepted']) {
    assert.equal(coffee.mutations.find((m) => m.id === id).status, 'not_applicable', id + ' 在咖啡域应不适用');
  }
  assert.equal(coffee.mutations.find((m) => m.id === 'm-ledger-sign-flip').status, 'not_applicable');
  assert.equal(coffee.summary.applicable + coffee.summary.notApplicable, coffee.summary.mutations);
  assert.equal(coffee.summary.survived, coffee.summary.applicable - coffee.summary.caught);
  assert.equal(coffee.summary.caughtRate, coffee.summary.caught / coffee.summary.applicable);

  // 反向：没声明的照旧适用；声明了缺集合就不适用
  const plain = { id: 'm-test-plain', title: 'x', layer: 'state', wrap: (a) => a };
  assert.equal(appliesTo(plain, { capabilities: [{ id: 'order.create' }], scopes: ['orders'] }), true);
  const scoped = { id: 'm-test-scoped', title: 'x', layer: 'state', applies_to: { collections: ['trial'] }, wrap: (a) => a };
  assert.equal(appliesTo(scoped, { scopes: ['orders', 'transactions'] }), false, '缺声明集合时不应适用');
  assert.equal(appliesTo(scoped, { scopes: ['orders', 'trial'] }), true);
});

test('不可移植字段不许被建议成断言', () => {
  // id / 时间 / 取餐号这类值由「谁先跑」「库自增」「时钟」决定，换实现必变。
  // 建议它们等于让人写一条必然失败（或必然空转）的检查项。
  for (const p of ['orders.0.id', 'orders.0.createTime', 'orders.0.pickupNo', 'status_log.0.at', 'orders.0.updatedAt']) {
    assert.equal(isPortablePath(p), false, `${p} 不该被当成可移植字段`);
  }
  for (const p of ['orders.0.status', 'orders.0.totalAmount', 'orders.0.items.0.count']) {
    assert.equal(isPortablePath(p), true, `${p} 是可移植字段，不该被挡`);
  }
  const base = { initial: { orders: [] }, final: { orders: [{ id: 1, status: 'PICKED' }] } };
  assert.equal(suggestFromWitness({ path: 'orders.0.id', correct: 1 }, base), null);
  assert.ok(suggestFromWitness({ path: 'orders.0.status', correct: 'PICKED' }, base));
});

test('--suggest 的产出能直接粘进案例，并交代哪些给不出', async () => {
  const report = await certify({ cases: all(), adapterFactory: () => createMemoryAdapter() });
  const text = formatSuggestions(report);
  const withSuggestion = report.mutations.filter((x) => !x.caught && x.suggestion);
  for (const m of withSuggestion) {
    assert.ok(text.includes(m.id), `建议里缺 ${m.id}`);
  }
  for (const m of report.mutations.filter((x) => !x.caught && x.suggestionBlocked && !x.suggestion)) {
    assert.ok(text.includes(m.id), `给不出的 ${m.id} 也要点名，不能沉默`);
  }
  if (withSuggestion.length > 0) {
    assert.ok(text.includes('field_equals') || text.includes('count_delta'));
  }
});

test('witness 能看见中途的差异：终态一样时也要报出来', async () => {
  const { traceDiff } = await import('../src/certify.mjs');
  const a = { trace: [{ stateAfter: { orders: [{ id: 1, status: 'NEW' }] } }, { stateAfter: { orders: [{ id: 1, status: 'DONE' }] } }] };
  const b = { trace: [{ stateAfter: { orders: [{ id: 1, status: 'NEW' }] } }, { stateAfter: { orders: [{ id: 1, status: 'NEW' }] } }] };
  const diff = traceDiff(a, b);
  assert.ok(diff.length > 0, '第 2 步状态不同，必须报出见证');
  assert.ok(diff[0].path.startsWith('trace.2.'), '见证路径要带步号，实际是 ' + diff[0].path);
  // 终态相同
  const same = traceDiff({ trace: [{ stateAfter: { x: 1 } }] }, { trace: [{ stateAfter: { x: 1 } }] });
  assert.equal(same.length, 0);
});

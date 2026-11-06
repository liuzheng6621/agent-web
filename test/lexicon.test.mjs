/**
 * 词库域（第四个域）的守卫。
 *
 * 这个域存在的唯一理由：补上「一次查询返回三位数以上、并且要翻页」这个形状。
 * 所以这里的测试不只校验案例合法性，更要**守住这个形状本身** ——
 * 如果哪天有人把 900 条砍到 20 条、或者把翻页案例删了，这个域就退化成了
 * 又一个「小数据全绿」的样本，必须红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCase } from '../src/case.mjs';
import { validateManifest } from '../src/adapter/contract.mjs';
import { createLexiconA } from '../examples/lexicon/adapter-a.mjs';
import { createLexiconB } from '../examples/lexicon/adapter-b.mjs';
import {
  buildLexicon,
  SYLLABLES,
  PREFIX_SAMPLE,
  SEGMENT_SAMPLE,
  ABSENT_WORD,
} from '../examples/lexicon/dataset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'cases', 'lexicon');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'expected.json').sort();
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const cases = files.map(load);

// ---------- 案例本身 ----------

test('词库域：每个案例都是合法案例（离线校验，不需要跑适配器）', () => {
  assert.ok(files.length >= 4, '案例数不该少于 4：' + files.length);
  for (const f of files) {
    const errors = validateCase(load(f));
    assert.deepEqual(errors, [], `${f} 不合法：${errors.join('；')}`);
  }
});

test('词库域：案例 id 与 expected.json 的键一一对应', () => {
  const ids = cases.map((c) => c.id).sort();
  const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
  assert.deepEqual(ids, Object.keys(expected).sort(),
    '案例与预期标签必须一一对应：改案例记得改 expected.json');
  for (const [id, label] of Object.entries(expected)) {
    assert.ok(['pass', 'fail', 'unknown'].includes(label), `${id} 的预期标签只能是 pass/fail/unknown`);
  }
});

test('词库域：案例 id 带域前缀，且四个案例各管一件事', () => {
  for (const c of cases) {
    assert.match(c.id, /^lexicon\//, `${c.id} 必须以 lexicon/ 开头`);
  }
  const kinds = new Set(cases.flatMap((c) => (c.task.goal_assertions ?? []).map((a) => a.kind)));
  for (const must of ['pagination', 'unique', 'subset', 'type_of', 'sorted_by', 'field_equals']) {
    assert.ok(kinds.has(must), `词库域少了 ${must} 断言：这个域的价值就在于把翻页与结构分开测`);
  }
});

// ---------- 形状：这是本域存在的理由 ----------

test('词库域：翻页案例的 total 必须远大于一页，否则翻页断言等于空转', () => {
  const paged = cases.find((c) => (c.task.goal_assertions ?? []).some((a) => a.kind === 'pagination'));
  assert.ok(paged, '词库域没有翻页案例，这个域就没有存在意义');
  const a = paged.task.goal_assertions.find((x) => x.kind === 'pagination');
  assert.ok(a.total >= 3 * a.pageSize,
    `翻页案例只翻得动 ${a.total} / 每页 ${a.pageSize}：少于三页就测不到边界丢行`);
  assert.ok(a.steps.length >= 3, '至少翻三页：两页测不到「中间页缺一行」');
  assert.equal(a.collection, 'entries');
});

test('词库域：数据集规模足够让翻页案例真的翻得动', () => {
  const rows = buildLexicon();
  assert.equal(rows.length, SYLLABLES.length ** 2, '900 条：30 个音节两两组合');
  assert.ok(rows.length >= 500, `数据集只剩 ${rows.length} 条，翻页与排序断言都失去了区分度`);
  // 前缀命中数必须与案例里写死的 total 一致，否则案例是空的
  const hits = rows.filter((r) => r.pinyin.startsWith(PREFIX_SAMPLE.prefix));
  assert.equal(hits.length, PREFIX_SAMPLE.expectTotal,
    `前缀 ${PREFIX_SAMPLE.prefix} 命中 ${hits.length} 条，案例声称 ${PREFIX_SAMPLE.expectTotal}`);
});

// ---------- 数据是合成的、确定的 ----------

test('词库域：数据由下标确定性生成，两次构建逐字段相同', () => {
  assert.deepEqual(buildLexicon(), buildLexicon(), '数据集必须是纯函数产物，否则判决指纹会漂');
});

test('词库域：id 唯一、rank 从 1 连续、拼音互不重复', () => {
  const rows = buildLexicon();
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, 'id 有重复');
  assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1), 'rank 必须是从 1 开始的下标');
  // 拼音唯一是「前缀命中数固定」的前提：同音会让命中条数随字表变化
  assert.equal(new Set(rows.map((r) => r.pinyin)).size, rows.length, '拼音有重复，前缀命中数就不再确定');
  const pys = new Set(SYLLABLES.map((s) => s.py));
  assert.equal(pys.size, SYLLABLES.length, '音节表的拼音有重复');
});

test('词库域：笔画是整数、类别在声明的五个值里', () => {
  const rows = buildLexicon();
  for (const r of rows) {
    assert.ok(Number.isInteger(r.strokes), `${r.id} 的 strokes 不是整数：${r.strokes}`);
    assert.ok(['nature', 'place', 'body', 'object', 'abstract'].includes(r.category), `${r.id} 的类别越界：${r.category}`);
  }
});

test('词库域：不存在的词确实不在词库里（否则「查不到」案例是假的）', () => {
  assert.equal(buildLexicon().some((r) => r.word === ABSENT_WORD), false);
});

// ---------- 两个实现：同一份契约，不同的算法 ----------

test('词库域：两个实现的 manifest 都合法', async () => {
  assert.deepEqual(validateManifest(await createLexiconA().manifest()), []);
  assert.deepEqual(validateManifest(await createLexiconB().manifest()), []);
});

test('词库域：两个实现的视图契约逐字相同（否则案例不可移植）', async () => {
  const a = await createLexiconA().manifest();
  const b = await createLexiconB().manifest();
  assert.deepEqual(validateManifest(a), []);
  assert.deepEqual(validateManifest(b), []);
  assert.deepEqual(a.view, b.view, '视图契约必须一致：集合名、必填字段、语义');
  assert.deepEqual(a.roles, b.roles);
  assert.deepEqual(
    a.capabilities.map((c) => c.id).sort(),
    b.capabilities.map((c) => c.id).sort(),
  );
  assert.notEqual(a.adapter, b.adapter, '两个实现的 adapter 名必须不同，否则 compare 会当成同一个');
});

test('词库域：同一页查询，两个实现给出同一批行与同一个 total', async () => {
  const A = createLexiconA();
  const B = createLexiconB();
  const ra = await A.reset({});
  const rb = await B.reset({});
  const args = { prefix: PREFIX_SAMPLE.prefix, page: 2, pageSize: 10 };
  const outA = await A.execute(ra.runId, { capability: 'lexicon.list', arguments: args });
  const outB = await B.execute(rb.runId, { capability: 'lexicon.list', arguments: args });
  assert.equal(outA.outcome, 'applied');
  assert.equal(outB.outcome, 'applied');
  assert.equal(outA.payload.total, outB.payload.total, 'total 不一致：前缀定界有一边错了');
  assert.equal(outA.payload.total, PREFIX_SAMPLE.expectTotal);
  assert.deepEqual(
    outA.payload.entries.map((r) => r.id),
    outB.payload.entries.map((r) => r.id),
    '同一页的行不一致：字典树与二分定界在边界上分叉了',
  );
});

test('词库域：翻完所有页，两个实现拿到的是同一份完整集合', async () => {
  const A = createLexiconA();
  const B = createLexiconB();
  const ra = await A.reset({});
  const rb = await B.reset({});
  const collect = async (ad, runId) => {
    const ids = [];
    for (let page = 1; page <= 3; page += 1) {
      const out = await ad.execute(runId, {
        capability: 'lexicon.list',
        arguments: { prefix: PREFIX_SAMPLE.prefix, page, pageSize: 10 },
      });
      ids.push(...out.payload.entries.map((r) => r.id));
    }
    return ids;
  };
  const ia = await collect(A, ra.runId);
  const ib = await collect(B, rb.runId);
  assert.equal(ia.length, PREFIX_SAMPLE.expectTotal, `翻了 3 页拿到 ${ia.length} 条`);
  assert.deepEqual(ia, ib);
  assert.equal(new Set(ia).size, ia.length, '翻页出现重复行');
});

test('词库域：分词结果两边一致，且与数据集声明相同', async () => {
  const A = createLexiconA();
  const B = createLexiconB();
  const ra = await A.reset({});
  const rb = await B.reset({});
  const args = { text: SEGMENT_SAMPLE.text };
  const outA = await A.execute(ra.runId, { capability: 'lexicon.segment', arguments: args });
  const outB = await B.execute(rb.runId, { capability: 'lexicon.segment', arguments: args });
  // 贪心最长匹配与反向 DP 在「两种切法等长」时会分叉，样本必须选切法唯一的那种
  assert.deepEqual(outA.payload.tokens, SEGMENT_SAMPLE.expectTokens);
  assert.deepEqual(outB.payload.tokens, SEGMENT_SAMPLE.expectTokens);
});

test('词库域：查不到的词两边都拒绝，不返回空对象', async () => {
  const A = createLexiconA();
  const B = createLexiconB();
  const ra = await A.reset({});
  const rb = await B.reset({});
  for (const ad of [A, B]) {
    const runId = ad === A ? ra.runId : rb.runId;
    const out = await ad.execute(runId, { capability: 'lexicon.lookup', arguments: { word: ABSENT_WORD } });
    assert.equal(out.outcome, 'rejected', `${ad === A ? 'A' : 'B'} 对不存在的词返回了 ${out.outcome}`);
    assert.equal(out.error.code, 'not_found');
  }
});

test('词库域：非法分页参数被拒绝，而不是悄悄夹到边界', async () => {
  const A = createLexiconA();
  const r = await A.reset({});
  for (const args of [{ page: 0 }, { pageSize: 0 }, { pageSize: 101 }, { prefix: 42 }]) {
    const out = await A.execute(r.runId, { capability: 'lexicon.list', arguments: args });
    assert.equal(out.outcome, 'rejected', `${JSON.stringify(args)} 应该被拒绝`);
    assert.equal(out.error.code, 'invalid_argument');
  }
});

// ---------- 变异体：本域的变异体必须真的声明在本域的集合上 ----------

test('词库域：词库变异体都已注册，且用 certify 的同款判据在词库域算「适用」', async () => {
  const { mutants } = await import('../docs/mutants/index.mjs');
  const { appliesTo } = await import('../src/certify.mjs');
  const manifest = await createLexiconA().manifest();
  const mine = mutants.filter((m) => m.id.startsWith('m-lexicon-'));
  assert.ok(mine.length >= 9, `词库变异体不该少于 9 个（当前 ${mine.length}）：少了就等于这个域在退化`);
  for (const m of mine) {
    // 声明范围可以是 capabilities 也可以是 collections，但必须能落到词库域的 manifest 上；
    // 落不上就是「不适用」，不进 certify 的分母 —— 那这个变异体等于没写。
    assert.ok(m.applies_to, `${m.id} 没有 applies_to：它会对所有域生效，包括不相干的`);
    assert.ok(appliesTo(m, manifest), `${m.id} 在词库域的 manifest 上判为不适用，等于没写`);
    // 反过来：词库变异体不该在咖啡域适用，否则 certify 的适用性判据没起作用
    const coffee = { capabilities: [{ id: 'orders.create' }], scopes: ['orders', 'menu', 'status_log'] };
    assert.equal(appliesTo(m, coffee), false, `${m.id} 在咖啡域也适用：applies_to 声明太宽`);
  }
  // 至少一个落在 execute 层、一个落在 state 层：只改一层的变异体抓不到另一层的错
  const layers = new Set(mine.map((m) => m.layer));
  assert.ok(layers.has('execute') && layers.has('state'),
    `词库变异体要覆盖两层，实际只有：${[...layers]}`);
});

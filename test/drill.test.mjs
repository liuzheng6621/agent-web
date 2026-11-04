import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { buildDrills, gradeDrills, taskSheet, safeName, gradeExit } from '../src/drill.mjs';
import { MUTATIONS } from '../src/mutate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function loadCase(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'cases/coffee', name + '.json'), 'utf8'));
}
const factory = async () => createMemoryAdapter();

async function drillsFor(names, mutations) {
  return await buildDrills({
    entries: names.map((n) => ({ file: 'cases/coffee/' + n + '.json', case: loadCase(n) })),
    adapterFactory: factory,
    adapterName: 'memory',
    timeoutMs: 5000,
    mutations,
  });
}

test('出题：只对"本来该判 pass 且看得见差异"的配对出手', async () => {
  const report = await drillsFor(['cancel-before-pickup'], MUTATIONS);
  const ids = report.items.map((i) => i.mutant).sort();
  assert.deepEqual(ids, ['m-extra-foreign-order', 'm-history-empty', 'm-money-off-by-cent']);
  // 已抓住的不出题、被删掉的变异体不出题
  assert.ok(report.generated.skipped >= 1, '被案例本身抓住的变异体应记入 skipped');
  assert.equal(report.generated.asked, 3);
  assert.equal(
    report.generated.asked + report.generated.skipped + report.generated.not_applicable + report.generated.invisible,
    report.generated.pairs,
  );
});

test('出题：见证型案例（本来就该判 fail）不出题', async () => {
  const report = await drillsFor(['skip-ready-stage'], MUTATIONS);
  assert.equal(report.items.length, 0);
  assert.equal(report.generated.not_applicable, MUTATIONS.length);
});

test('题面不含答案', async () => {
  const report = await drillsFor(['cancel-before-pickup'], MUTATIONS);
  for (const item of report.items) {
    const sheet = taskSheet(item);
    assert.ok(sheet.includes(item.symptom), '症状必须给，不然题没法做');
    assert.ok(!sheet.includes(item.catch_hint), 'catch_hint 是答案，不能出现在题面上');
    assert.ok(!sheet.includes('"mutant"'), '题面不该暴露变异体 id');
  }
});

test('文件名安全化：/ 和 @ 都要换掉', () => {
  assert.equal(safeName('coffee/happy-path@m-no-reject'), 'coffee__happy-path-at-m-no-reject');
  assert.ok(!safeName('a/b@c').includes('/'));
});

test('批改：抓得住就解出，抓不住就点名，乱写记 unarmed', async () => {
  const report = await drillsFor(['cancel-before-pickup'], MUTATIONS);
  const c = loadCase('cancel-before-pickup');
  const subs = new Map();
  for (const item of report.items) {
    const good = {
      'm-money-off-by-cent': [
        { kind: 'field_equals', selector: { collection: 'orders', index: 0 }, path: 'totalAmount', value: 56 },
      ],
      'm-history-empty': [
        { kind: 'count_delta', selector: { collection: 'status_log', where: [{ field: 'type', eq: 'order.canceled' }] }, delta: 1 },
      ],
      'm-extra-foreign-order': [{ kind: 'count_delta', selector: { collection: 'orders' }, delta: 1 }],
    }[item.mutant];
    subs.set(safeName(item.id), { assertions: good });
  }
  const graded = await gradeDrills({
    items: report.items,
    submissions: subs,
    adapterFactory: factory,
    adapterName: 'memory',
    timeoutMs: 5000,
    loadCase: async () => c,
  });
  assert.equal(graded.summary.solved, 3);
  assert.equal(graded.summary.missed, 0);
  assert.equal(graded.summary.rate, 1);
  assert.equal(gradeExit(graded, { min: 0.9 }), 0);
});

test('批改：把案例自己的断言抄一遍，一分都拿不到', async () => {
  const report = await drillsFor(['cancel-before-pickup'], MUTATIONS);
  const c = loadCase('cancel-before-pickup');
  const lazy = { assertions: [{ kind: 'field_equals', selector: { collection: 'orders', index: 0 }, path: 'status', value: 'CANCELED' }] };
  const subs = new Map(report.items.map((i) => [safeName(i.id), lazy]));
  const graded = await gradeDrills({
    items: report.items, submissions: subs, adapterFactory: factory, adapterName: 'memory', timeoutMs: 5000, loadCase: async () => c,
  });
  assert.equal(graded.summary.solved, 0);
  assert.equal(graded.summary.missed, 3);
  assert.ok(graded.rows.every((r) => r.detail.includes('看不见这个故障')));
  assert.equal(gradeExit(graded, {}), 1);
});

test('批改：格式不对 / 空提交 / 没作答 分别记，不会当成没抓到', async () => {
  const report = await drillsFor(['cancel-before-pickup'], MUTATIONS);
  const c = loadCase('cancel-before-pickup');
  const [a, b, d] = report.items;
  const subs = new Map([
    [safeName(a.id), { assertions: [{ kind: 'llm_judge', prompt: '看起来对不对' }] }],
    [safeName(b.id), { assertions: [] }],
  ]);
  const graded = await gradeDrills({
    items: report.items, submissions: subs, adapterFactory: factory, adapterName: 'memory', timeoutMs: 5000, loadCase: async () => c,
  });
  assert.equal(graded.summary.invalid, 1);
  assert.equal(graded.summary.empty, 1);
  assert.equal(graded.summary.unanswered, 1);
  assert.equal(graded.summary.graded, 0);
  assert.equal(graded.summary.rate, null, '分母为 0 时必须是 null，不是 0');
  assert.equal(gradeExit(graded, { min: 0.1 }), 1, 'rate 为 null 一律不达标');
  assert.equal(gradeExit(graded, {}), 1, '还有题批改不了，不能算通过');
  assert.ok(graded.rows.find((r) => r.id === a.id).detail.includes('llm_judge'));
});

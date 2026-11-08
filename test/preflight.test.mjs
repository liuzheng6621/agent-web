import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightCase, preflightAll, consistency, formatPreflight, preflightExit } from '../src/preflight.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const readDir = (dir) => fs.readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith('.json') && f !== 'expected.json' && f !== 'manifest.json')
  .map((f) => readJson(path.join(dir, f)));

const manifest = await createMemoryAdapter().manifest();

test('preflight：能力齐全的案例预测 ready', () => {
  const r = preflightCase({ case: readJson('cases/coffee/happy-path.json'), manifest });
  assert.equal(r.predicted, 'ready');
  assert.deepEqual(r.missing.capabilities, []);
  assert.ok(r.checks.every((c) => c.ok));
});

test('preflight：清单里没有的能力，静态就判 unknown', () => {
  const r = preflightCase({ case: readJson('cases/coffee/unknown-capability.json'), manifest });
  assert.equal(r.predicted, 'unknown');
  assert.deepEqual(r.missing.capabilities, ['order.refund']);
  assert.equal(r.checks.find((c) => c.axis === 'capability').ok, false);
});

test('preflight：期望成功却用了不允许的身份，预测 fail 而不是 unknown', () => {
  const r = preflightCase({ case: readJson('cases/coffee/foreign-pickup.json'), manifest });
  assert.equal(r.predicted, 'fail');
  assert.deepEqual(r.missing.role_rules, ['order.pick 不接受 customer2']);
});

test('preflight：负例故意用错身份不算问题（只看 expected_outcome=applied 的步）', () => {
  const c = {
    id: 'x/neg-role',
    reference_trajectory: [
      { id: 's1', capability: 'order.pick', as: 'customer2', expected_outcome: 'rejected', arguments: { orderId: 1 } },
    ],
  };
  const r = preflightCase({ case: c, manifest });
  assert.equal(r.predicted, 'ready', '被拒绝的步骤不该触发身份检查');
});

test('preflight：集合不可观测与事件词表缺失都预测 unknown', () => {
  const c = {
    id: 'x/gaps',
    task: {
      natural_goal: 'g',
      goal_assertions: [
        { kind: 'field_equals', selector: { collection: 'invoices', index: 0 }, path: 'status', value: 'PAID' },
        { kind: 'event_absent', type: 'order.teleported' },
      ],
    },
    reference_trajectory: [
      { id: 's1', capability: 'order.create', as: 'customer', expected_outcome: 'applied', arguments: { items: [] } },
    ],
  };
  const r = preflightCase({ case: c, manifest });
  assert.equal(r.predicted, 'unknown');
  assert.deepEqual(r.missing.collections, ['invoices']);
  assert.deepEqual(r.missing.events, ['order.teleported']);
});

test('preflight：预测与 expected.json 对不上才判红', () => {
  assert.equal(consistency({ predicted: 'unknown' }, 'unknown'), true);
  assert.equal(consistency({ predicted: 'unknown' }, 'invalid'), true);
  assert.equal(consistency({ predicted: 'unknown' }, 'pass'), false);
  assert.equal(consistency({ predicted: 'fail' }, 'fail'), true);
  assert.equal(consistency({ predicted: 'fail' }, 'pass'), false);
  assert.equal(consistency({ predicted: 'ready' }, 'pass'), true);
  // 没有标签时只拦必然 unknown：fail 预测本身不是错，它只是提前说了会红。
  assert.equal(consistency({ predicted: 'unknown' }, undefined), false);
  assert.equal(consistency({ predicted: 'fail' }, undefined), true);
});

test('preflight：咖啡域 13 条全部与预期自洽', () => {
  const cases = readDir('cases/coffee');
  const expected = readJson('cases/coffee/expected.json');
  const results = preflightAll({ cases, manifest, expected });
  assert.equal(results.length, 13);
  for (const r of results) {
    assert.ok(r.consistent, `${r.case_id} 预测 ${r.predicted} 与预期 ${r.expected} 不符`);
  }
  assert.equal(preflightExit(results), 0);
});

test('preflight：拿错适配器时必须报警，而不是沉默通过', () => {
  const cases = readDir('cases/animal');
  const expected = readJson('cases/animal/expected.json');
  const results = preflightAll({ cases, manifest, expected });
  const bad = results.filter((r) => !r.consistent);
  assert.ok(bad.length > 0, '用咖啡域的清单去预检动物域，必须判红');
  assert.equal(preflightExit(results), 1);
  for (const r of bad) {
    assert.equal(r.predicted, 'unknown');
    assert.ok(r.missing.capabilities.length > 0, '应指出缺哪些能力');
  }
});

test('preflight：报告把预测、预期和差异分开写', () => {
  const cases = readDir('cases/coffee');
  const expected = readJson('cases/coffee/expected.json');
  const text = formatPreflight(preflightAll({ cases, manifest, expected }), { detail: true });
  assert.match(text, /预测 ready 11 \/ unknown 1 \/ fail 1/);
  assert.match(text, /order\.refund/);
  assert.match(text, /order\.pick 不接受 customer2/);
  assert.doesNotMatch(text, /与预期不符/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fingerprintVerdict,
  fingerprintAll,
  diffFingerprints,
  stableStringify,
  formatDeterminismReport,
} from '../src/determinism.mjs';
import { judge } from '../src/runner.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const baseVerdict = () => ({
  case_id: 'coffee/happy-path',
  status: 'pass',
  reason_code: 'ok',
  stage: 'goal',
  detail: '目标与不变量全部成立',
  goal_results: [{ kind: 'field_equals', status: true }],
  invariant_results: [],
  failed_assertions: [],
  evidence: { trace: [{ index: 0, capability: 'order.create', as: 'customer', expected_outcome: 'applied', outcome: 'applied', error: null }] },
  finished_at: '2026-11-06T00:00:00.000Z',
  timing_ms: 12,
});

test('determinism：时间戳与耗时不进指纹', () => {
  const a = baseVerdict();
  const b = { ...baseVerdict(), finished_at: '2030-01-01T00:00:00.000Z', timing_ms: 9999 };
  assert.deepEqual(fingerprintVerdict(a), fingerprintVerdict(b));
  assert.deepEqual(diffFingerprints([fingerprintVerdict(a)], [fingerprintVerdict(b)]), []);
});

test('determinism：stableStringify 与键顺序无关', () => {
  assert.equal(stableStringify({ a: 1, b: { c: 2, d: 3 } }), stableStringify({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('determinism：判决变了必须被抓到，且指出路径', () => {
  const a = fingerprintVerdict(baseVerdict());
  const b = fingerprintVerdict({ ...baseVerdict(), status: 'fail', reason_code: 'assertion_false' });
  const diffs = diffFingerprints([a], [b]);
  const paths = diffs.map((d) => d.path);
  assert.ok(paths.includes('status'), '应指出 status 变了');
  assert.ok(paths.includes('reason_code'), '应指出 reason_code 变了');
  assert.ok(diffs.every((d) => d.case_id === 'coffee/happy-path'));
});

test('determinism：同一个判决、不同的逐步回执也算漂移', () => {
  const a = baseVerdict();
  const b = baseVerdict();
  b.evidence.trace[0].outcome = 'rejected';
  const diffs = diffFingerprints([fingerprintVerdict(a)], [fingerprintVerdict(b)]);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'trace[0].outcome');
  assert.equal(diffs[0].before, 'applied');
  assert.equal(diffs[0].after, 'rejected');
});

test('determinism：多一条 / 少一条案例都要报，不静默跳过', () => {
  const one = [fingerprintVerdict(baseVerdict())];
  const two = [fingerprintVerdict({ ...baseVerdict(), case_id: 'coffee/two-items' })];
  const d1 = diffFingerprints(one, two);
  assert.ok(d1.some((d) => d.kind === 'extra' && d.case_id === 'coffee/two-items'));
  assert.ok(d1.some((d) => d.kind === 'missing' && d.case_id === 'coffee/happy-path'));
});

test('determinism：严格模式把证据摘要也算进去', () => {
  const a = baseVerdict();
  const b = baseVerdict();
  b.evidence.trace[0].as = 'customer2';
  const loose = diffFingerprints([fingerprintVerdict(a)], [fingerprintVerdict(b)]);
  const strict = diffFingerprints(
    [fingerprintVerdict(a, { strict: true })],
    [fingerprintVerdict(b, { strict: true })],
  );
  assert.ok(strict.length >= loose.length, '严格模式不该比宽松模式更少');
  assert.ok(strict.some((d) => d.path === 'evidence_sha256'), '严格模式应比证据摘要');
});

test('determinism：报告要么说一致，要么逐条给差异', () => {
  assert.match(formatDeterminismReport([], { cases: 3 }), /3 条案例指纹逐字一致/);
  const a = fingerprintVerdict(baseVerdict());
  const b = fingerprintVerdict({ ...baseVerdict(), status: 'fail' });
  const text = formatDeterminismReport(diffFingerprints([a], [b]), { cases: 1 });
  assert.match(text, /漂移/);
  assert.match(text, /status/);
});

test('determinism：内存适配器连跑两遍，指纹必须逐字相同', async () => {
  const c = readJson('cases/coffee/happy-path.json');
  const adapter = createMemoryAdapter();
  const v1 = await judge({ case: c, adapter, adapterName: 'memory' });
  const v2 = await judge({ case: c, adapter, adapterName: 'memory' });
  const f1 = fingerprintAll([v1], { strict: true });
  const f2 = fingerprintAll([v2], { strict: true });
  assert.deepEqual(diffFingerprints(f1, f2), [], '同一进程内连跑两遍就漂移了');
});

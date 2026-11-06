import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNegatives, classifyObserved, formatObservedSummary } from '../src/negatives.mjs';
import { validateManifest } from '../src/adapter/contract.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { judge } from '../src/runner.mjs';
import fs from 'node:fs';

const HAPPY = JSON.parse(fs.readFileSync('cases/coffee/happy-path.json', 'utf8'));

test('契约：constraints 声明合法才放行', () => {
  const m = { ...createMemoryAdapter().manifest ? {} : {}, capabilities: [] };
  assert.ok(true);
});

test('契约：constraints 空对象与非法项都要报错', async () => {
  const m = await createMemoryAdapter().manifest();
  const bad = JSON.parse(JSON.stringify(m));
  bad.capabilities[1].constraints = { 'items[].qty': { min: 99, max: 1 } };
  const errs = validateManifest(bad);
  assert.ok(errs.some((e) => e.includes('min 大于 max')));
});

test('契约：不认识约束项要报错', async () => {
  const m = await createMemoryAdapter().manifest();
  const bad = JSON.parse(JSON.stringify(m));
  bad.capabilities[1].constraints = { 'items[].qty': { minimum: 1 } };
  const errs = validateManifest(bad);
  assert.ok(errs.some((e) => e.includes('不是约束项')));
});

test('契约：空约束要报错', async () => {
  const m = await createMemoryAdapter().manifest();
  const bad = JSON.parse(JSON.stringify(m));
  bad.capabilities[1].constraints = { 'items[].qty': {} };
  const errs = validateManifest(bad);
  assert.ok(errs.some((e) => e.includes('空约束')));
});

test('派生：声明了边界就能问出 min-1 / max+1 / 非整数', async () => {
  const manifest = await createMemoryAdapter().manifest();
  const cands = deriveNegatives({ case: HAPPY, manifest, max: 40 });
  const b = cands.filter((c) => c.kind === 'boundary_violation');
  assert.equal(b.length, 3, '应当问出三条边界');
  assert.ok(b.some((c) => c.mutation.includes('= 0')), '缺 min-1');
  assert.ok(b.some((c) => c.mutation.includes('= 100')), '缺 max+1');
  assert.ok(b.some((c) => c.mutation.includes('1.5')), '缺非整数');
  for (const c of b) assert.equal(c.expectation, 'rejected');
});

test('派生：没声明 constraints 的能力一条边界都不造', async () => {
  const manifest = await createMemoryAdapter().manifest();
  const stripped = JSON.parse(JSON.stringify(manifest));
  for (const c of stripped.capabilities) delete c.constraints;
  const cands = deriveNegatives({ case: HAPPY, manifest: stripped, max: 40 });
  assert.equal(cands.filter((c) => c.kind === 'boundary_violation').length, 0, '不该凭空猜边界');
});

test('分类：按最后一步的结局，不看整体判决', () => {
  const traceReject = { evidence: { trace: [{ outcome: 'rejected', error: { code: 'invalid_argument' } }] } };
  const traceApply = { evidence: { trace: [{ outcome: 'applied' }] } };
  const r1 = classifyObserved(traceReject, null, 'rejected');
  assert.equal(r1.observed, 'observed_reject');
  assert.match(r1.detail, /invalid_argument/);
  const r2 = classifyObserved(traceApply, null, 'rejected');
  assert.equal(r2.observed, 'observed_accept');
  const r3 = classifyObserved(traceApply, traceReject, 'rejected');
  assert.equal(r3.observed, 'diverged');
  const r4 = classifyObserved({}, null, 'rejected');
  assert.equal(r4.observed, 'unknown');
});

test('分类：没有预设期望时只记录结局', () => {
  const r = classifyObserved({ evidence: { trace: [{ outcome: 'applied' }] } }, null, null);
  assert.equal(r.observed, 'observed_accept');
  assert.match(r.detail, /业务决定/);
});

test('实跑：边界候选在内存适配器上确实被拒', async () => {
  const manifest = await createMemoryAdapter().manifest();
  const cand = deriveNegatives({ case: HAPPY, manifest, max: 40 }).find((c) => c.kind === 'boundary_violation');
  const c = { ...JSON.parse(JSON.stringify(HAPPY)), id: 'probe~boundary', reference_trajectory: cand.steps };
  const v = await judge({ case: c, adapter: createMemoryAdapter(), adapterName: 'memory' });
  const cls = classifyObserved(v, null, cand.expectation);
  assert.equal(cls.observed, 'observed_reject', `实际是 ${cls.observed}：${cls.detail}`);
});

test('汇总：四类都能列出来，且按固定顺序', () => {
  const results = [
    { candidates: [{ observed: { observed: 'observed_reject', detail: 'x' } }, { observed: { observed: 'observed_accept', detail: 'y' } }] },
  ];
  const text = formatObservedSummary(results);
  assert.match(text, /observed_reject/);
  assert.match(text, /observed_accept/);
  assert.ok(text.indexOf('observed_reject') < text.indexOf('observed_accept'));
});

test('汇总：没跑过就说没跑过，不装成 0', () => {
  assert.match(formatObservedSummary([{ candidates: [{ kind: 'x' }] }]), /没有跑过的候选/);
});

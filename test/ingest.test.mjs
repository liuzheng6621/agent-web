import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INGEST_VERSION, ingestReport, formatIngest, ingestExit } from '../src/ingest.mjs';

const FIXTURE = path.join(import.meta.dirname, '..', 'fixtures', 'external', 'e2e-report-1.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('摄入一份真实形状的 e2e 报告：五条结果按三值口径重新落位', () => {
  const r = ingestReport(load());
  assert.equal(r.ingest_version, INGEST_VERSION);
  assert.equal(r.source, 'e2e');
  assert.equal(r.schema_version, 'report-1');
  assert.equal(r.error, undefined);
  assert.equal(r.counts.results, 5, '五条结果');
  assert.equal(r.counts.pass, 1);
  assert.equal(r.counts.fail, 1);
  assert.equal(r.counts.unknown, 3, 'flaky + skipped + 一条运行层事故');
  assert.equal(r.counts.not_run, 1, '被过滤的那条不进分母');
});

test('passed 但声明了 expectedFailure：通过的是缺陷仍在，不是产品正常', () => {
  const r = ingestReport(load());
  const row = r.tests.find((t) => t.title.includes('opens app'));
  assert.ok(row, '找得到那一行');
  assert.equal(row.status, 'passed');
  assert.equal(row.verdict, 'pass');
  assert.equal(row.reason_code, 'expected_failure_still_present');
  assert.equal(r.counts.expected_failure_confirmed, 1);
  assert.ok(r.warnings.some((w) => w.code === 'expected_failure'), '必须报出来');
});

test('判决是谁下的：模型断言与机器断言分开数', () => {
  const r = ingestReport(load());
  assert.equal(r.by_basis.model, 1, 'agent.assert 是模型判定');
  assert.equal(r.by_basis.machine, 1, 'expect.toContainText 是机器判定');
  assert.equal(r.by_basis.none, 2, 'flaky 与 skipped 一条断言都没有');
  const model = r.tests.find((t) => t.title.includes('opens app'));
  assert.equal(model.basis, 'model');
  const machine = r.tests.find((t) => t.title.includes('shows total'));
  assert.equal(machine.basis, 'machine');
});

test('可判定率把 unknown 留在分母里', () => {
  const r = ingestReport(load());
  assert.equal(r.judgeable.numerator, 2);
  assert.equal(r.judgeable.denominator, 5, '四条有效结果 + 一条运行层事故');
  assert.equal(r.judgeable.value, 0.4);
  assert.equal(r.machine_share.value, 0.5, '两条判决里只有一条是机器下的');
});

test('运行层事故留痕但不算产品判决', () => {
  const r = ingestReport(load());
  assert.equal(r.suite_errors.length, 1);
  assert.equal(r.suite_errors[0].code, 'HOOK_FAILED');
  assert.ok(!r.tests.some((t) => t.title === 'checkout'), '事故没有被伪造成一条测试结果');
  assert.equal(r.by_reason['unknown/suite_error:HOOK_FAILED'], 1);
});

test('认不出的 schemaVersion：说认不出，不猜字段', () => {
  const r = ingestReport({ schemaVersion: 'junit-9', tests: [] });
  assert.equal(r.error, 'unknown_schema');
  assert.equal(r.exitCode, 2);
  assert.match(formatIngest(r), /认不出来/);
});

test('表外状态落成 unknown 并退 2，绝不默认成 pass', () => {
  const doc = load();
  doc.run.results[1].status = 'quarantined';
  const r = ingestReport(doc);
  assert.equal(r.exitCode, 2);
  assert.equal(r.unmapped.length, 1);
  assert.equal(r.unmapped[0].status, 'quarantined');
  const row = r.tests.find((t) => t.title.includes('shows total'));
  assert.equal(row.verdict, 'unknown');
  assert.equal(row.reason_code, 'unmapped_status:quarantined');
});

test('文本报告说得清机器判定占比与欠账', () => {
  const text = formatIngest(ingestReport(load()));
  assert.match(text, /可判定率 2\/5 = 40\.0%/);
  assert.match(text, /机器判定占比 1\/2 = 50\.0%/);
  assert.match(text, /只有这几条判决跨得了实现/);
  assert.match(text, /blind/);
  assert.equal(ingestExit(ingestReport(load())), 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recurrence, RECURRENCE_VERSION } from '../src/assert/recurrence.mjs';
import { KINDS, PHASE_MATRIX, validateAssertion, phaseOf } from '../src/assert/index.mjs';

const RUNS = (times) => ({
  runs: times.map((t, i) => ({ id: i + 1, jobId: 1, scheduledFor: t, status: 'success' })),
});
const BASE = {
  selector: { collection: 'runs', where: [{ field: 'jobId', eq: 1 }] },
  field: 'scheduledFor',
  every: '15m',
  from: '2026-01-01T00:00:00Z',
  to: '2026-01-01T00:45:00Z',
  timezone: 'UTC',
};
const slot = (k, stepMin = 15) =>
  new Date(Date.parse('2026-01-01T00:00:00Z') + k * stepMin * 60000).toISOString();

test('注册表：第 20 种，相位固定 final', () => {
  assert.equal(KINDS.length, 20, '节律上线后是 20 种');
  assert.ok(KINDS.includes('recurrence'));
  assert.deepEqual(PHASE_MATRIX.recurrence.allowed, ['final']);
  assert.equal(phaseOf({ kind: 'recurrence' }), 'final');
});

test('跑满：4 个槽位一个不多一个不少 → true', () => {
  const r = recurrence(BASE, { final: RUNS([0, 1, 2, 3].map((k) => slot(k))) });
  assert.equal(r.status, 'true');
  assert.equal(r.code, 'ok');
});

test('漏跑：少一个槽位 → false/recurrence_gap，并且点名是哪几个', () => {
  const r = recurrence(BASE, { final: RUNS([0, 2, 3].map((k) => slot(k))) });
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'recurrence_gap');
  assert.match(r.message, /漏跑 1 个槽位/);
  assert.match(r.message, /#2@/);
});

test('多跑同一槽位 → false/recurrence_duplicated（不是「数量多了」）', () => {
  const r = recurrence(BASE, { final: RUNS([0, 1, 1, 2, 3].map((k) => slot(k))) });
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'recurrence_duplicated');
  assert.match(r.message, /第 2 个槽位跑了两次/);
});

test('漂移：次数全对、每个都晚 5 分钟，容差 0 → false/recurrence_drift', () => {
  const late = [0, 1, 2, 3].map((k) => slot(k, 15).replace(/00\.000Z$/, '00.000Z'));
  const shifted = [0, 1, 2, 3].map((k) =>
    new Date(Date.parse(slot(k)) + 5 * 60000).toISOString(),
  );
  const r = recurrence(BASE, { final: RUNS(shifted) });
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'recurrence_drift');
  assert.match(r.message, /容差 0ms/);
  // 反向：容差放宽到 10 分钟，同一份数据必须转 true —— 容差是案例的显式决定，不是实现偷偷放宽。
  const ok = recurrence({ ...BASE, tolerance_ms: 10 * 60000 }, { final: RUNS(shifted) });
  assert.equal(ok.status, 'true');
  assert.equal(late.length, 4);
});

test('expect_count 不符 → false/recurrence_count_mismatch', () => {
  const r = recurrence({ ...BASE, expect_count: 5 }, { final: RUNS([0, 1, 2, 3].map((k) => slot(k))) });
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'recurrence_count_mismatch');
});

test('窗口外的行不算「越界」：它属于别的窗口', () => {
  const times = [0, 1, 2, 3].map((k) => slot(k)).concat([slot(9)]);
  const r = recurrence(BASE, { final: RUNS(times) });
  assert.equal(r.status, 'true');
});

test('没声明时区 → unknown/missing_timezone，不猜', () => {
  const r = recurrence({ ...BASE, timezone: undefined }, { final: RUNS([0, 1, 2, 3].map((k) => slot(k))) });
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_timezone');
});

test('记录缺时间戳 → unknown/missing_observation，不判假', () => {
  const r = recurrence(BASE, { final: { runs: [{ id: 1, jobId: 1, status: 'success' }] } });
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_observation');
});

test('没有 runs 这个集合 → unknown/missing_observation', () => {
  const r = recurrence(BASE, { final: {} });
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_observation');
});

test('节律写错 → unknown/invalid_case，不判假', () => {
  const r = recurrence({ ...BASE, every: '每周' }, { final: RUNS([slot(0)]) });
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'invalid_case');
});

test('槽位数超过上限 → unknown/invalid_case（先说案例写错了，再谈判决）', () => {
  const r = recurrence(
    { ...BASE, every: '1ms', to: '2026-01-01T00:10:00Z' },
    { final: RUNS([slot(0)]) },
  );
  assert.equal(r.status, 'unknown');
  assert.match(r.message, /超过 10000/);
});

test('校验：every/from/to/timezone 必填，tolerance 与 expect_count 得合法', () => {
  const errs = validateAssertion({ kind: 'recurrence' });
  assert.ok(errs.some((e) => e.includes('.every')));
  assert.ok(errs.some((e) => e.includes('.from')));
  assert.ok(errs.some((e) => e.includes('.to')));
  assert.ok(errs.some((e) => e.includes('timezone')));
  const errs2 = validateAssertion({
    kind: 'recurrence', every: '15m', from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z',
    timezone: 'UTC', tolerance_ms: -1, expect_count: 1.5,
  });
  assert.ok(errs2.some((e) => e.includes('tolerance_ms')));
  assert.ok(errs2.some((e) => e.includes('expect_count')));
});

test('版本号可读，且改动会换版本', () => {
  assert.equal(RECURRENCE_VERSION, 'agent-web/recurrence-1');
});

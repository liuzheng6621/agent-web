import test from 'node:test';
import assert from 'node:assert/strict';
import { timeliness, durationMs } from '../src/assert/timeliness.mjs';
import { validateAssertion, KINDS, PHASE_MATRIX, phaseOf } from '../src/assert/index.mjs';

const HOUR = 3600000;

function ctxWith(rows) {
  return { final: { status_log: rows }, initial: { status_log: [] }, trace: [] };
}

const CREATED = { type: 'order.created', orderId: 1, at: 1000 };
const PICKED_FAST = { type: 'order.picked', orderId: 1, at: 1000 + 2 * HOUR };
const PICKED_LATE = { type: 'order.picked', orderId: 1, at: 1000 + 30 * HOUR };

const SPEC = { from: { type: 'order.created' }, to: { type: 'order.picked' }, max: '24h', timezone: 'UTC' };

test('时长写法：24h / 90m / 5000ms 都能读成毫秒', () => {
  assert.equal(durationMs('24h'), 24 * HOUR);
  assert.equal(durationMs('90m'), 90 * 60000);
  assert.equal(durationMs('5000ms'), 5000);
  assert.equal(durationMs('2d'), 48 * HOUR);
  assert.equal(durationMs('随便'), null);
});

test('在窗口内判真', () => {
  const r = timeliness({ ...SPEC }, ctxWith([CREATED, PICKED_FAST]));
  assert.equal(r.status, 'true');
});

test('超出上限判假，并写出实际间隔', () => {
  const r = timeliness({ ...SPEC }, ctxWith([CREATED, PICKED_LATE]));
  assert.equal(r.status, 'false');
  assert.equal(r.code, 'timeliness_violated');
  assert.match(r.message, /30\.00h/);
});

test('恰好等于上限算成立：24 小时内包含 24 小时', () => {
  const r = timeliness({ ...SPEC }, ctxWith([CREATED, { ...PICKED_FAST, at: 1000 + 24 * HOUR }]));
  assert.equal(r.status, 'true');
});

test('事件没时间戳判 unknown，不判假', () => {
  const r = timeliness({ ...SPEC }, ctxWith([CREATED, { type: 'order.picked', orderId: 1 }]));
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_observation');
});

test('没声明时区判 unknown，不猜', () => {
  const r = timeliness({ ...SPEC, timezone: undefined }, ctxWith([CREATED, PICKED_FAST]));
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_timezone');
});

test('找不到事件判 unknown', () => {
  const r = timeliness({ ...SPEC }, ctxWith([CREATED]));
  assert.equal(r.status, 'unknown');
  assert.match(r.message, /找不到终点事件/);
});

test('终点早于起点判假', () => {
  const r = timeliness({ ...SPEC }, ctxWith([{ ...CREATED, at: 5000 }, { ...PICKED_FAST, at: 2000 }]));
  assert.equal(r.status, 'false');
  assert.match(r.message, /比起点事件早/);
});

test('ISO 字符串时间戳也能比', () => {
  const r = timeliness(
    { ...SPEC },
    ctxWith([
      { type: 'order.created', at: '2026-01-01T00:00:00Z' },
      { type: 'order.picked', at: '2026-01-01T03:00:00Z' },
    ]),
  );
  assert.equal(r.status, 'true');
});

test('校验：缺 from/to/max 都报错', () => {
  const errs = validateAssertion({ kind: 'timeliness', timezone: 'UTC' });
  assert.ok(errs.some((e) => e.includes('from')));
  assert.ok(errs.some((e) => e.includes('to')));
  assert.ok(errs.some((e) => e.includes('max')));
});

test('校验：max 读不成时长要报错', () => {
  const errs = validateAssertion({ kind: 'timeliness', from: { type: 'a' }, to: { type: 'b' }, max: '半天', timezone: 'UTC' });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /读不成时长/);
});

test('校验：不给时区必须报错（时间比较不能靠猜）', () => {
  const errs = validateAssertion({ kind: 'timeliness', from: { type: 'a' }, to: { type: 'b' }, max: '24h' });
  assert.equal(errs.length, 1);
  assert.match(errs[0], /timezone/);
});

test('注册表：timeliness 是第 18 种，相位固定 final', () => {
  assert.equal(KINDS.length, 19, '状态机上线后是 19 种');
  assert.ok(KINDS.includes('timeliness'));
  assert.deepEqual(PHASE_MATRIX.timeliness.allowed, ['final']);
  assert.equal(phaseOf({ kind: 'timeliness' }), 'final');
});

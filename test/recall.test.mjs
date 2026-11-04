import test from 'node:test';
import assert from 'node:assert/strict';
import { ENTRIES, KNOWLEDGE_VERSION, validateAll, validateEntry, entryById } from '../knowledge/index.mjs';
import {
  witnessMatches, recallSignals, bump, recallExit, signalsFromCertify, signalsFromProbe,
} from '../src/recall.mjs';

test('档案全库合法，且每条都有判据（宪法）', () => {
  const r = validateAll();
  assert.equal(r.ok, true, r.problems.join(' | '));
  assert.ok(ENTRIES.length >= 8);
  for (const e of ENTRIES) assert.notEqual(e.guard.kind, 'none');
});

test('没有判据的条目被拒收', () => {
  const bad = { ...entryById('k-identity-collapse'), id: 'k-no-guard', guard: { kind: 'none', ref: 'x' } };
  const r = validateEntry(bad);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('不许入库')));
});

test('缺 repro 的条目被拒收', () => {
  const bad = { ...entryById('k-identity-collapse'), id: 'k-no-repro' };
  delete bad.repro;
  const r = validateEntry(bad);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes('repro')));
});

test('见证路径通配匹配', () => {
  assert.equal(witnessMatches('orders.*.pickupNo', 'orders.0.pickupNo'), true);
  assert.equal(witnessMatches('orders.*.pickupNo', 'orders.3.pickupNo'), true);
  assert.equal(witnessMatches('orders.*.pickupNo', 'orders.0.totalAmount'), false);
  assert.equal(witnessMatches('*.(id|pickupNo)', 'orders.0.pickupNo'), true);
  assert.equal(witnessMatches('orders.*.(id|pickupNo)', 'orders.0.pickupNo'), true);
  assert.equal(witnessMatches('menu.*.dishName', 'menu.2.dishName'), true);
  assert.equal(witnessMatches('menu.*.dishName', 'menu.2.price'), false);
});

test('默认只按检测项 id 精确命中', () => {
  const sig = [{ detector: 'certify:m-pickup-no-offset', witness: 'orders.0.pickupNo' }];
  const r = recallSignals(sig);
  assert.deepEqual(r.matchedIds, ['k-unportable-assertion']);
  assert.equal(r.hits[0].how, 'detector');
});

test('检测项不在档案里时不命中，并进 unseen', () => {
  const sig = [{ detector: 'certify:m-never-seen', witness: 'orders.0.x' }];
  const r = recallSignals(sig);
  assert.equal(r.hits.length, 0);
  assert.equal(r.unseen.length, 1);
});

test('--loose 退到见证路径匹配', () => {
  const sig = [{ detector: 'certify:something-else', witness: 'orders.0.pickupNo' }];
  assert.equal(recallSignals(sig).hits.length, 0);
  const loose = recallSignals(sig, { loose: true });
  assert.ok(loose.hits.length >= 1);
  assert.equal(loose.hits[0].how, 'witness');
});

test('加深记忆：第一次放过，第二次拦下', () => {
  const state = { counts: {}, runs: 0 };
  const first = bump(state, ['k-x']);
  assert.equal(first[0].after, 1);
  assert.equal(first[0].gate, false);
  assert.equal(recallExit(first), 0);
  const second = bump(state, ['k-x']);
  assert.equal(second[0].after, 2);
  assert.equal(second[0].gate, true);
  assert.equal(recallExit(second), 1);
  assert.equal(recallExit(second, { noGate: true }), 0);
});

test('certify 报告里只有未被抓住的变异体算信号', () => {
  const report = { mutations: [
    { id: 'm-a', caught: true },
    { id: 'm-b', caught: false, status: 'killable', witness: { path: 'orders.0.totalAmount' } },
  ] };
  const sig = signalsFromCertify(report);
  assert.equal(sig.length, 1);
  assert.equal(sig[0].detector, 'certify:m-b');
  assert.equal(sig[0].witness, 'orders.0.totalAmount');
});

test('探针只有 fail 的检查算信号（warn 不算）', () => {
  const report = { checks: [
    { id: 'contract', status: 'pass' },
    { id: 'no-leak', status: 'warn' },
    { id: 'reset', status: 'fail', message: '复位后状态不同' },
  ] };
  const sig = signalsFromProbe(report);
  assert.equal(sig.length, 1);
  assert.equal(sig[0].detector, 'probe:reset');
});

test('版本号是带日期的稳定标识', () => {
  assert.equal(KNOWLEDGE_VERSION, 'agent-web/knowledge-1');
});

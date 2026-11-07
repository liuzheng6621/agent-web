/**
 * 分类语义只能有一份实现。
 *
 * 这不是风格洁癖：v0.60.0 修了 runner 里那段 if 链，draft.mjs 里的手抄副本带着
 * 同一个洞活了一个版本。能抓这件事的测试必须比对**结构**，不能只比对行为 ——
 * 两份实现行为一致的时候，恰恰是最难发现它们会一起烂掉的时候。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { classifyStepOutcome } from '../src/step-outcome.mjs';
import { OUTCOMES } from '../src/adapter/contract.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const STEP = (expected = 'applied') => ({ id: 's1', capability: 'order.create', expected_outcome: expected });

test('两处调用点都走共享实现，没有第二份手写分支', () => {
  for (const file of ['src/runner.mjs', 'src/draft.mjs']) {
    const s = read(file);
    assert.match(s, /classifyStepOutcome/, `${file} 必须调用 classifyStepOutcome`);
    // 手写的 outcome 分支是回归的形态。允许保留的只有 applied 那一条（记 outputs）。
    const hand = [...s.matchAll(/res\.outcome === '([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(hand, ['applied'],
      `${file} 里出现了手写的 outcome 分支：${hand.join(',')}。分类语义只能有一份`);
  }
});

test('共享实现对每个非法 outcome 给出同一个理由码', () => {
  for (const bad of ['success', 'ok', 'applied ', 'APPLIED', 'done', '', null, undefined]) {
    const r = classifyStepOutcome({ res: { outcome: bad }, step: STEP(), index: 0 });
    assert.equal(r?.code, 'contract_violation', `outcome=${JSON.stringify(bad)} 没被拦下`);
    assert.equal(r.status, 'unknown');
  }
});

test('四档契约内 outcome 各自落到对的理由码', () => {
  const cases = [
    [{ outcome: 'unsupported' }, 'coverage_gap'],
    [{ outcome: 'infra_error', error: { message: 'boom' } }, 'infrastructure_error'],
    [{ outcome: 'may_have_committed', error: { code: 'ETIMEDOUT' } }, 'effect_uncertain'],
    [{ outcome: 'rejected', error: { code: 'X', message: 'no' } }, 'unexpected_rejection'],
  ];
  for (const [res, code] of cases) {
    assert.equal(classifyStepOutcome({ res, step: STEP(), index: 0 })?.code, code);
  }
  assert.equal(classifyStepOutcome({ res: { outcome: 'applied' }, step: STEP(), index: 0 }), null);
});

test('outcome 枚举本身是封闭的：加一档必须同时决定它算不算「不确定」', () => {
  // 这条测试的用途：将来加第六档时，这个断言会红，逼人去想
  // 「它要不要进 UNCERTAIN_OUTCOMES」。漏想一次，重放器就会重跑一次已经生效的写。
  assert.deepEqual([...OUTCOMES], ['applied', 'rejected', 'unsupported', 'infra_error', 'may_have_committed']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveNegatives,
  renderNegativeSheet,
  writeNegatives,
  looksLikeKey,
  absentValue,
  wrongTypeValue,
  isOptionalType,
  baseType,
} from '../src/negatives.mjs';
import { validateSteps } from '../src/case.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const manifest = await createMemoryAdapter().manifest();
const happy = readJson('cases/coffee/happy-path.json');

test('negatives：必填缺失 / 角色越权 / 类型不符 / 不存在实体 / 重复提交 都能派生', () => {
  const cands = deriveNegatives({ case: happy, manifest });
  const kinds = new Set(cands.map((c) => c.kind));
  for (const k of ['missing_required_arg', 'role_violation', 'wrong_type', 'unknown_entity', 'duplicate_submit']) {
    assert.ok(kinds.has(k), `缺 ${k} 类候选，实际有 ${[...kinds].join(',')}`);
  }
});

test('negatives：全部是 disputed，没有一条能冒充判决', () => {
  const cands = deriveNegatives({ case: happy, manifest });
  assert.ok(cands.length > 0);
  for (const c of cands) {
    assert.equal(c.status, 'disputed', c.key + ' 不是 disputed');
    assert.ok(c.basis && c.basis.length > 0, c.key + ' 缺依据');
    assert.ok(Array.isArray(c.review) && c.review.length > 0, c.key + ' 缺待确认项');
    assert.ok(c.expectation === 'rejected' || c.expectation === null, c.key + ' 的期望只能是 rejected 或待定');
  }
});

test('negatives：派生的轨迹本身必须是合法轨迹', () => {
  const cands = deriveNegatives({ case: happy, manifest });
  for (const c of cands) {
    const errors = validateSteps(c.steps, c.key);
    assert.deepEqual(errors, [], c.key + ' 的 steps 不合法：' + errors.join('; '));
  }
});

test('negatives：审阅表说拒绝，轨迹最后一步就必须写 rejected', () => {
  const cands = deriveNegatives({ case: happy, manifest });
  for (const c of cands) {
    if (c.expectation === null) continue;
    const last = c.steps[c.steps.length - 1];
    assert.equal(last.expected_outcome, c.expectation, c.key + ' 的期望与轨迹不一致');
  }
});

test('negatives：重复提交只给两个假设，不替人选', () => {
  const cands = deriveNegatives({ case: happy, manifest });
  const dup = cands.filter((c) => c.kind === 'duplicate_submit');
  assert.ok(dup.length > 0);
  for (const c of dup) {
    assert.equal(c.expectation, null, '重复提交不能自带期望');
    assert.deepEqual(c.hypotheses, ['applied', 'rejected']);
    assert.equal(c.confidence, 'low');
  }
});

test('negatives：max 是硬上限，不会因为案例大就爆炸', () => {
  const cands = deriveNegatives({ case: happy, manifest, max: 3 });
  assert.equal(cands.length, 3);
});

test('negatives：写盘只落在 out 目录，案例目录一个字节都不动', () => {
  const before = fs.readdirSync(path.join(ROOT, 'cases/coffee'))
    .map((f) => f + ':' + fs.statSync(path.join(ROOT, 'cases/coffee', f)).mtimeMs)
    .join('|');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-web-negatives-'));
  const cands = deriveNegatives({ case: happy, manifest });
  const written = writeNegatives(out, [{ case_id: happy.id, source: 'cases/coffee/happy-path.json', candidates: cands }]);
  const after = fs.readdirSync(path.join(ROOT, 'cases/coffee'))
    .map((f) => f + ':' + fs.statSync(path.join(ROOT, 'cases/coffee', f)).mtimeMs)
    .join('|');
  assert.equal(before, after, '案例目录被改了');
  assert.ok(written.files.length === 2, '应写出一份 json 和一份 md');
  for (const f of written.files) assert.ok(f.startsWith(path.resolve(out)), f + ' 写到了 out 之外');
  const doc = JSON.parse(fs.readFileSync(written.files[0], 'utf8'));
  assert.equal(doc.schema_version, 'agent-web/negatives/0.1');
  assert.ok(doc.note.includes('disputed'));
  fs.rmSync(out, { recursive: true, force: true });
});

test('negatives：审阅表明确写着「不进判决」', () => {
  const cands = deriveNegatives({ case: happy, manifest });
  const md = renderNegativeSheet(happy.id, cands);
  assert.ok(md.includes('disputed'));
  assert.ok(md.includes('不替你决定'));
  assert.ok(md.includes('accept'));
  assert.ok(md.includes('- [ ]'), '审阅表要能勾');
});

test('negatives：类型与主键判定是纯函数，边界明确', () => {
  assert.equal(isOptionalType('string?'), true);
  assert.equal(isOptionalType('Array<{id:string}>'), false);
  assert.equal(baseType('number? '), 'number');
  assert.equal(looksLikeKey('orderId'), true);
  assert.equal(looksLikeKey('applicationId'), true);
  assert.equal(looksLikeKey('id'), true);
  assert.equal(looksLikeKey('slug'), true);
  assert.equal(looksLikeKey('valid'), false, 'valid 不是主键');
  assert.equal(looksLikeKey('username'), true);
  assert.equal(absentValue('integer'), 987654321);
  assert.equal(typeof absentValue('string'), 'string');
  assert.equal(wrongTypeValue('number'), 'not-a-number');
  assert.deepEqual(wrongTypeValue('string'), { unexpected: 'object' });
  assert.equal(wrongTypeValue('Array<{a:string}>'), 'not-an-array');
});

test('negatives：清单里没声明的能力不猜', () => {
  const fake = {
    id: 'fake/x',
    reference_trajectory: [
      { id: 's1', capability: 'ghost.call', as: 'user', expected_outcome: 'applied', arguments: { a: 1 } },
    ],
  };
  assert.deepEqual(deriveNegatives({ case: fake, manifest }), []);
});

// `report --counts` 的全部价值在于「它只是数」。
// 所以这个测试的第一组用例不是「数得对不对」，而是「它没变成评分」：
// 输出里出现 score / grade / rank / 建议 / 评分 这类词就算越界。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  countTrajectory, formatCounts, COUNT_KEYS, COUNTS_VERSION,
} from '../src/counts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'agent-web.mjs');

const step = (id, capability, extra = {}) => ({ id, capability, outcome: 'applied', arguments: {}, ...extra });

test('计数：五个键，一个不多一个不少', () => {
  const c = countTrajectory([step('s1', 'order.list')]);
  assert.deepEqual(Object.keys(c).sort(), [...COUNT_KEYS].sort());
  assert.equal(COUNTS_VERSION, 'agent-web/counts-1');
});

test('计数：同一读能力同一参数读两次，多出来那次记 1', () => {
  const c = countTrajectory([
    step('s1', 'order.list', { arguments: { page: 1 } }),
    step('s2', 'order.list', { arguments: { page: 1 } }),
    step('s3', 'order.list', { arguments: { page: 2 } }),
  ]);
  assert.equal(c.repeat_reads, 1);
});

test('计数：参数不同就不算重复读', () => {
  const c = countTrajectory([
    step('s1', 'menu.get', { arguments: { id: 1 } }),
    step('s2', 'menu.get', { arguments: { id: 2 } }),
  ]);
  assert.equal(c.repeat_reads, 0);
});

test('计数：给了 manifest 的读能力集合，就按它判，不靠名字后缀猜', () => {
  const steps = [
    step('s1', 'notes.query', { arguments: {} }),
    step('s2', 'notes.query', { arguments: {} }),
  ];
  assert.equal(countTrajectory(steps).repeat_reads, 0, '后缀不像读，猜不到');
  assert.equal(countTrajectory(steps, { reads: new Set(['notes.query']) }).repeat_reads, 1);
});

test('计数：失败之后同参数再来一次记一次重试', () => {
  const c = countTrajectory([
    step('s1', 'order.create', { arguments: { items: [] }, outcome: 'rejected' }),
    step('s2', 'order.create', { arguments: { items: [] }, outcome: 'applied' }),
  ]);
  assert.equal(c.retries, 1);
});

test('计数：成功之后同样的调用不算重试（那是幂等重放，不是重试）', () => {
  const c = countTrajectory([
    step('s1', 'order.create', { arguments: { items: [] } }),
    step('s2', 'order.create', { arguments: { items: [] } }),
  ]);
  assert.equal(c.retries, 0);
});

test('计数：建完又用它的产出撤掉，记一次白做的写', () => {
  const c = countTrajectory([
    step('s1', 'order.create', { arguments: { items: [] } }),
    step('s2', 'order.cancel', { arguments: { orderId: '$s1.orderId' } }),
  ]);
  assert.equal(c.wasted_writes, 1);
});

test('计数：撤掉的是另一条，不算白做', () => {
  const c = countTrajectory([
    step('s1', 'order.create', { arguments: { items: [] } }),
    step('s2', 'order.cancel', { arguments: { orderId: '999' } }),
  ]);
  assert.equal(c.wasted_writes, 0);
});

test('计数：绕路比的分母是案例参考轨迹的步数', () => {
  const steps = [
    step('s1', 'order.create', { arguments: { items: [] } }),
    step('s2', 'order.list', { arguments: {} }),
    step('s3', 'order.cancel', { arguments: { orderId: '$s1.orderId' } }),
    step('s4', 'order.create', { arguments: { items: [] } }),
  ];
  assert.equal(countTrajectory(steps, { referenceSteps: 2 }).detour_ratio, 2);
  assert.equal(countTrajectory(steps, { referenceSteps: 4 }).detour_ratio, 1);
});

test('计数：没有参考轨迹时绕路比是 null，不编一个数', () => {
  const steps = [step('s1', 'order.list', { arguments: {} })];
  assert.equal(countTrajectory(steps).detour_ratio, null,
    '分母不知道就写 null —— 写成 1 会让人以为「一步没多走」');
});

test('计数：空轨迹不炸，绕路比是 null 而不是 0', () => {
  const c = countTrajectory([]);
  assert.equal(c.steps, 0);
  assert.equal(c.detour_ratio, null, '0 会被读成「零绕路」，null 才是「没东西可数」');
});

const BANNED = ['score', 'grade', 'rank', '建议', '优秀', '较差', '评分', '打分', '质量分'];

test('输出里不许出现评分词：这是计数不是评价', () => {
  const text = formatCounts([
    { case_id: 'coffee/happy-path', counts: countTrajectory([step('s1', 'order.list')]) },
  ]);
  for (const word of BANNED) {
    assert.equal(text.includes(word), false, `输出里出现了「${word}」——那是评分的入口`);
  }
  assert.match(text, /只数不判/);
});

test('CLI：给了 --cases 之后绕路比才算得出来', () => {
  const out = path.join(ROOT, '.tmp-counts-cases.jsonl');
  const v = spawnSync(process.execPath, [CLI, 'verify', 'cases/coffee/happy-path.json',
    '--adapter=memory', `--out=${out}`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(v.status, 0, v.stderr);

  const plain = spawnSync(process.execPath, [CLI, 'report', out, '--counts', '--json'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(JSON.parse(plain.stdout)[0].detour_ratio, null);

  const withCases = spawnSync(process.execPath, [CLI, 'report', out, '--counts', '--cases=cases/coffee', '--json'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(JSON.parse(withCases.stdout)[0].detour_ratio, 1,
    '参考轨迹 4 步、实走 4 步 → 1');
  fs.unlinkSync(out);
});

test('CLI：report --counts --json 的每个对象只有五个计数键', () => {
  const out = path.join(ROOT, '.tmp-counts.jsonl');
  const v = spawnSync(process.execPath, [CLI, 'verify', 'cases/coffee/happy-path.json',
    '--adapter=memory', `--out=${out}`], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(v.status, 0, v.stderr);

  const r = spawnSync(process.execPath, [CLI, 'report', out, '--counts', '--json'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['case_id', ...COUNT_KEYS].sort());
  fs.unlinkSync(out);
});

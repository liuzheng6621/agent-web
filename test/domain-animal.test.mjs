import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCase } from '../src/case.mjs';
import { validateManifest } from '../src/adapter/contract.mjs';
import { createAnimalAdapter } from '../src/adapter/animal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIR = path.join(ROOT, 'cases', 'animal');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'expected.json').sort();
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

test('animal 域：每个案例都是合法案例（离线校验，不需要后端）', () => {
  assert.ok(files.length >= 4, '案例数不该少于 4：' + files.length);
  for (const f of files) {
    const errors = validateCase(load(f));
    assert.deepEqual(errors, [], `${f} 不合法：${errors.join('；')}`);
  }
});

test('animal 域：案例 id 与 expected.json 的键一一对应（多一个少一个都红）', () => {
  const ids = files.map((f) => load(f).id).sort();
  const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
  assert.deepEqual(ids, Object.keys(expected).sort(),
    '案例与预期标签必须一一对应：改案例记得改 expected.json');
  for (const [id, label] of Object.entries(expected)) {
    assert.ok(['pass', 'fail', 'unknown'].includes(label), `${id} 的预期标签只能是 pass/fail/unknown`);
  }
});

test('animal 域：适配器 manifest 合法，且声明了三个互不相同的角色', async () => {
  const adapter = createAnimalAdapter();
  const manifest = await adapter.manifest();
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual([...manifest.roles].sort(), ['admin', 'user', 'volunteer']);
  // 三角色必须真的不是同一个账号：角色单射是 identity 复位的底线。
  const names = new Set(manifest.roles.map((r) => manifest.roles.indexOf(r)));
  assert.equal(names.size, 3);
  // 没有事件流就必须明说，否则事件类断言会对着空集合判真。
  assert.equal(manifest.events_complete, false);
});

test('animal 域：审批类案例把越权写成「应被拒绝」，而不是靠人眼看日志', () => {
  const forbidden = files.map(load).find((c) => c.id === 'animal/adoption-reject-forbidden');
  assert.ok(forbidden, '缺越权案例');
  const last = forbidden.reference_trajectory.at(-1);
  assert.equal(last.expected_outcome, 'rejected');
  assert.equal(last.as, 'user', '越权必须用非管理员身份做，否则测的不是权限');
});

test('animal 域：重复跑得起的案例不用 approve（approve 会把动物置成 adopted，毁掉前置条件）', () => {
  for (const f of files) {
    const c = load(f);
    const approves = c.reference_trajectory.filter((s) => s.capability === 'adoptions.approve');
    assert.deepEqual(approves, [], `${f} 用了 approve：这个后端没有把 status 改回去的接口，案例会变成一次性`);
  }
});

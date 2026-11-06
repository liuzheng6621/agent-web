// 第六个域：实验室预约／审批／门禁凭证／器材借用。
// 这几条门全是离线的：不连 8182、不需要管理员密码，只验案例文件与适配器声明对得上。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCase } from '../src/case.mjs';
import { createLabAccessAdapter } from '../src/adapter/labaccess.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'cases/labaccess');

function readCases() {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json') && f !== 'expected.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
}

const cases = readCases();
const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));

test('labaccess：四条案例都通过格式校验', () => {
  assert.equal(cases.length, 4);
  for (const c of cases) assert.deepEqual(validateCase(c), [], c.id);
});

test('labaccess：案例 id 与 expected.json 的键一一对应', () => {
  assert.deepEqual(cases.map((c) => c.id).sort(), Object.keys(expected).sort());
});

test('labaccess：每一步用到的能力都在适配器 manifest 里声明过', async () => {
  const adapter = createLabAccessAdapter({ baseUrl: 'http://127.0.0.1:1' });
  const manifest = await adapter.manifest();
  const declared = new Set(manifest.capabilities.map((c) => c.id));
  for (const c of cases) {
    for (const step of c.reference_trajectory) {
      assert.ok(declared.has(step.capability), `${c.id} 用了未声明的能力 ${step.capability}`);
    }
  }
});

test('labaccess：审批与借还只允许教师，提交与口令只允许学生', async () => {
  const adapter = createLabAccessAdapter({ baseUrl: 'http://127.0.0.1:1' });
  const manifest = await adapter.manifest();
  const byId = Object.fromEntries(manifest.capabilities.map((c) => [c.id, c]));
  for (const id of ['reservations.approve', 'reservations.reject', 'borrow.approve', 'borrow.return']) {
    assert.deepEqual(byId[id].roles, ['teacher'], id);
  }
  for (const id of ['reservations.create', 'reservations.cancel', 'access.otp', 'borrow.create']) {
    assert.deepEqual(byId[id].roles, ['student'], id);
  }
});

test('labaccess：这个后端没有实体事件流，manifest 必须诚实写 false', async () => {
  const adapter = createLabAccessAdapter({ baseUrl: 'http://127.0.0.1:1' });
  const manifest = await adapter.manifest();
  assert.equal(manifest.events_complete, false, '写 true 会诱使别人拿事件断言去查它');
});

test('labaccess：口令案例必须是「还没到点就拿不到」，不是「能拿到」', () => {
  const c = cases.find((x) => x.id === 'labaccess/otp-before-window');
  assert.ok(c, '缺 otp-before-window');
  const otp = c.reference_trajectory.find((s) => s.capability === 'access.otp');
  assert.equal(otp.expected_outcome, 'rejected',
    '时间窗规则一旦放宽，这条会先红——这正是它存在的意义');
});

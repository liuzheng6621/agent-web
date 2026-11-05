import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHurl, toCases, capabilityOf, writeImport, HURL_VERSION } from '../src/import-hurl.mjs';
import { payload, jsonPath } from '../src/assert/payload.mjs';
import { KINDS, validateAssertions, evalAssertions } from '../src/assert/index.mjs';

const SAMPLE = [
  '# Setup',
  'POST {{host}}/api/users',
  '{',
  '  "user": { "username": "u_{{uid}}", "password": "pw" }',
  '}',
  'HTTP 201',
  '[Captures]',
  'token: jsonpath "$.user.token"',
  '',
  'GET {{host}}/api/tags',
  'HTTP 200',
  '[Asserts]',
  'jsonpath "$.tags" isList',
  'jsonpath "$.tags" count >= 2',
  'jsonpath "$.tags" count == 2',
  'jsonpath "$.tags" contains "h_{{uid}}"',
  'jsonpath "$.tags[0]" isString',
  '',
  'DELETE {{host}}/api/bad',
  'HTTP 404',
].join('\n');

test('hurl：解析出请求、捕获、断言、状态行', () => {
  const blocks = parseHurl(SAMPLE);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].method, 'POST');
  assert.equal(blocks[0].status, 201);
  assert.deepEqual(blocks[0].captures, [{ name: 'token', path: '$.user.token' }]);
  assert.equal(blocks[1].asserts.length, 5);
  assert.deepEqual(blocks[1].asserts[1], { path: '$.tags', op: 'count_gte', raw: '2' });
  assert.deepEqual(blocks[1].asserts[2], { path: '$.tags', op: 'count_equals', raw: '2' });
  assert.equal(blocks[2].status, 404);
  assert.equal(blocks[0].body.user.password, 'pw');
});

test('hurl：能力名与路径参数', () => {
  assert.equal(capabilityOf('POST', '{{host}}/api/users').capability, 'users.create');
  assert.equal(capabilityOf('GET', '{{host}}/api/tags').capability, 'tags.list');
  assert.equal(capabilityOf('GET', '{{host}}/api/articles/{{slug}}').capability, 'articles.get');
  assert.equal(capabilityOf('DELETE', '{{host}}/api/articles/{{slug}}').capability, 'articles.delete');
});

test('hurl：转出来的案例能过校验，且默认是未确认草稿', () => {
  const { case: c, todo } = toCases(parseHurl(SAMPLE), { id: 'sample', as: 'user', uid: '42' });
  assert.equal(c.id, 'realworld/sample');
  assert.equal(c.draft.status, 'unconfirmed');
  assert.equal(c.reference_trajectory.length, 3);
  // 注册与登录不是匿名动作：它们就是在确立这个角色的身份，
  // 后面 as=user 的步骤才能用上新 token（否则会一直用复位时那个人的 token）。
  assert.equal(c.reference_trajectory[0].as, 'user');      // 注册 = 确立身份
  assert.equal(c.reference_trajectory[1].as, 'anonymous'); // 没带 Authorization 就是匿名
  assert.equal(c.task.goal_assertions.length, 5);
  assert.equal(todo.length, 0);
  const errs = validateAssertions(c.task.goal_assertions, 'task.goal_assertions');
  assert.deepEqual(errs, []);
});

test('hurl：认证头决定角色，4xx 决定 expected_outcome', () => {
  const text = ['GET {{host}}/api/tags', 'Authorization: Token {{token}}', 'HTTP 200', '', 'POST {{host}}/api/x', 'HTTP 422'].join('\n');
  const { case: c } = toCases(parseHurl(text), { id: 'r', as: 'user' });
  assert.equal(c.reference_trajectory[0].as, 'user');
  assert.equal(c.reference_trajectory[0].expected_outcome, 'applied');
  assert.equal(c.reference_trajectory[1].expected_outcome, 'rejected');
});

test('hurl：读不懂的断言进待办，不许悄悄丢掉', () => {
  const text = ['GET {{host}}/api/tags', 'HTTP 200', '[Asserts]', 'jsonpath "$.tags" isSorted'].join('\n');
  const { case: c, todo } = toCases(parseHurl(text), { id: 'x' });
  assert.equal(c.task.goal_assertions.length, 0);
  assert.equal(todo.length, 1);
  assert.match(todo[0], /isSorted/);
});

test('hurl：5xx 的请求不写成案例', () => {
  const text = ['GET {{host}}/api/boom', 'HTTP 500'].join('\n');
  const { case: c, todo } = toCases(parseHurl(text), { id: 'x' });
  assert.equal(c.reference_trajectory.length, 0);
  assert.match(todo[0], /500/);
});

test('hurl：writeImport 写出 .json，有待办时再写 .todo.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hurl-'));
  const src = path.join(dir, 'a.hurl');
  fs.writeFileSync(src, SAMPLE, 'utf8');
  const out = path.join(dir, 'out');
  const made = writeImport(src, out, { as: 'user', uid: '7' });
  assert.equal(made.length, 1);
  assert.equal(made[0].steps, 3);
  assert.ok(fs.existsSync(path.join(out, 'a.json')));
  assert.ok(!fs.existsSync(path.join(out, 'a.todo.md')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('payload：简化 JSONPath 取值', () => {
  const p = { user: { token: 't' }, tags: ['a', 'b'], rows: [{ id: 1 }] };
  assert.equal(jsonPath('$.user.token', p), 't');
  assert.equal(jsonPath('$.tags[1]', p), 'b');
  assert.equal(jsonPath('$.rows[0].id', p), 1);
  assert.equal(jsonPath('$.nope', p), undefined);
  assert.equal(jsonPath('user.token', p), undefined);
});

test('payload：六种 op 都按三值判', () => {
  const ctx = { trace: [{ payload: { tags: ['a', 'b'], token: 'x', empty: [], n: 3 } }] };
  const run = (a) => payload({ step: 1, ...a }, ctx);
  assert.equal(run({ path: '$.token', op: 'is_string' }).status, 'true');
  assert.equal(run({ path: '$.tags', op: 'is_list' }).status, 'true');
  assert.equal(run({ path: '$.empty', op: 'not_empty' }).status, 'false');
  assert.equal(run({ path: '$.tags', op: 'count_gte', value: 2 }).status, 'true');
  assert.equal(run({ path: '$.tags', op: 'count_equals', value: 3 }).status, 'false');
  assert.equal(run({ path: '$.tags', op: 'contains', value: 'b' }).status, 'true');
  assert.equal(run({ path: '$.n', op: 'equals', value: 3 }).status, 'true');
  assert.equal(run({ path: '$.n', op: 'equals', value: '3' }).status, 'false');
});

test('payload：看不到返回体时是 unknown，不是 fail', () => {
  const r = payload({ step: 2, path: '$.a', op: 'is_list' }, { trace: [{}] });
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'missing_observation');
});

test('payload：缺参数在校验期就报错', () => {
  const errs = validateAssertions([{ kind: 'payload', path: '$.a', op: 'is_list' }], 'x');
  assert.ok(errs.some((e) => e.includes('step')));
  const errs2 = validateAssertions([{ kind: 'payload', step: 1, path: 'a', op: 'is_list' }], 'x');
  assert.ok(errs2.some((e) => e.includes('path')));
  const errs3 = validateAssertions([{ kind: 'payload', step: 1, path: '$.a', op: 'count_gte' }], 'x');
  assert.ok(errs3.some((e) => e.includes('value')));
});

test('payload 已在 KINDS 里，且相位只允许 trace', () => {
  assert.ok(KINDS.includes('payload'));
  const errs = validateAssertions([{ kind: 'payload', step: 1, path: '$.a', op: 'is_list', phase: 'final' }], 'x');
  assert.ok(errs.some((e) => e.includes('trace')));
});

test('payload：一次求值走完整条链路', () => {
  const ctx = { trace: [{ payload: { ok: [1, 2] } }] };
  const r = evalAssertions([{ kind: 'payload', step: 1, path: '$.ok', op: 'count_gte', value: 2 }], ctx);
  assert.equal(r.status, 'true');
  assert.equal(r.results[0].status, 'true');
  assert.equal(HURL_VERSION, 'agent-web/hurl-1');
});

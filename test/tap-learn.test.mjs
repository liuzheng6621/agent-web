// tap / decl / learn / twin 的单元与回路测试：全部起本地 http，不碰外网。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseYaml, stringifyYaml } from '../src/yaml.mjs';
import { startTap } from '../src/tap.mjs';
import { readTraffic, learnTraffic, buildTwin, buildCases, emitSpec } from '../src/learn.mjs';
import { createAdapterFromSpec, compileSelector, classifyStatus } from '../src/adapter/decl.mjs';
import { createTwinAdapter } from '../src/adapter/twin.mjs';
import { validateCase } from '../src/case.mjs';

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-' + tag + '-'));
}

// 最小 CRUD 夹具：登录发 token、列表用 {items:[...]} 包裹、创建返回 201。
function startFixture() {
  const tokens = new Map([['dev', 'tok-dev'], ['admin', 'tok-admin']]);
  const tasks = [];
  const users = [{ username: 'dev', role: 'member' }, { username: 'admin', role: 'admin' }];
  let nextId = 1;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      const auth = String(req.headers.authorization || '');
      const who = [...tokens.entries()].find(([, t]) => auth === 'Bearer ' + t)?.[0] ?? null;
      if (req.url === '/login' && req.method === 'POST') {
        const t = tokens.get(body.username);
        if (t && body.password === 'pw-' + body.username) return send(200, { token: t, role: body.username });
        return send(401, { code: 40101, message: 'bad' });
      }
      if (!who) return send(401, { code: 40101, message: 'no token' });
      if (req.url === '/api/tasks' && req.method === 'GET') return send(200, { items: tasks.map((t) => ({ ...t })) });
      if (req.url === '/api/tasks' && req.method === 'POST') {
        if (!body.title) return send(400, { code: 40001, message: 'title 必填' });
        const t = { id: nextId++, title: body.title, done: false, owner: who };
        tasks.push(t);
        return send(201, { ...t });
      }
      if (req.url === '/api/users' && req.method === 'GET') return send(200, { items: users });
      const mComplete = req.url.match(/^\/api\/tasks\/(\d+)\/complete$/);
      if (mComplete && req.method === 'POST') {
        const t = tasks.find((x) => x.id === Number(mComplete[1]));
        if (!t) return send(404, { code: 40401 });
        t.done = true;
        return send(200, { ...t });
      }
      return send(404, { code: 40400, message: 'no route' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: 'http://127.0.0.1:' + server.address().port,
      close: () => new Promise((r) => server.close(r)),
      tasks,
    }));
  });
}

test('yaml：块映射/序列/注释往返不丢结构', () => {
  const text = [
    'adapter: demo',
    'roles:',
    '  - dev',
    '  - admin',
    'capabilities:',
    '  tasks.create:',
    '    POST: /api/tasks',
    '    as:',
    '      - dev',
    'view:',
    '  tasks:',
    '    from: GET /api/tasks',
    '# 这行是注释，不该进结果',
    '    fields:',
    '      id: $.id',
  ].join('\n');
  const spec = parseYaml(text);
  assert.equal(spec.adapter, 'demo');
  assert.deepEqual(spec.roles, ['dev', 'admin']);
  assert.equal(spec.capabilities['tasks.create'].POST, '/api/tasks');
  assert.deepEqual(spec.capabilities['tasks.create'].as, ['dev']);
  assert.equal(spec.view.tasks.from, 'GET /api/tasks');
  assert.equal(spec.view.tasks.fields.id, '$.id');
  assert.deepEqual(parseYaml(stringifyYaml(spec)), spec);
});

test('decl：选择器支持点号、[*] 与 {alias:src} 投影，数字下标明确不支持', () => {
  const root = { orders: [{ id: 1, items: [{ name: 'a' }] }, { id: 2, items: [] }] };
  assert.equal(compileSelector('$.orders')(root).length, 2);
  assert.deepEqual(compileSelector('$.orders[*].id')(root), [1, 2]);
  assert.deepEqual(compileSelector('$.orders[*].{orderId:id}')(root), [{ orderId: 1 }, { orderId: 2 }]);
  assert.equal(compileSelector('$.orders[*].{n:id}')(root)[1].n, 2);
  assert.throws(() => compileSelector('$.orders[0].id'), /读不懂/);
  assert.throws(() => compileSelector('orders.id'), /必须以 \$ 开头/);
});

test('decl：状态码归类默认按 2xx/4xx/5xx 分档，errors 表可以逐码改写', () => {
  assert.equal(classifyStatus(201), 'applied');
  assert.equal(classifyStatus(204), 'applied');
  assert.equal(classifyStatus(400), 'rejected');
  assert.equal(classifyStatus(409), 'rejected');
  assert.equal(classifyStatus(500), 'infra_error');
  // 真实接口里「没有这个能力」要靠 errors 表点名，默认的 404 只是 rejected
  assert.equal(classifyStatus(404), 'rejected');
  assert.equal(classifyStatus(404, 40401, { 40401: 'unsupported' }), 'unsupported');
  assert.equal(classifyStatus(400, 40001, { 40001: 'rejected' }), 'rejected');
  assert.equal(classifyStatus(418, undefined, { '4xx': 'infra_error' }), 'infra_error');
});

test('tap：转发真流量，正文与头部里的口令一律换伪名', async (t) => {
  const fx = await startFixture();
  const out = tmpDir('tap');
  const tap = startTap({ target: fx.url, port: 18921, out, quiet: true });
  t.after(async () => { await tap.stop(); await fx.close(); });
  const call = async (method, p, body, token) => {
    const res = await fetch(tap.url + p, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };
  const login = await call('POST', '/login', { username: 'dev', password: 'pw-dev' });
  assert.equal(login.token, 'tok-dev');
  const created = await call('POST', '/api/tasks', { title: 'alpha' }, login.token);
  assert.equal(created.title, 'alpha');
  await call('GET', '/api/tasks', null, login.token);
  await tap.stop();

  const file = path.join(out, 'traffic.jsonl');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('pw-dev'), '明文口令不该进录制');
  assert.ok(!raw.includes('tok-dev'), '明文 token 不该进录制');
  assert.ok(raw.includes('password#'), '口令应被换成伪名');
  const recs = readTraffic(file);
  assert.equal(recs.length, 3);
  assert.equal(recs[0].method, 'POST');
  assert.equal(recs[2].method, 'GET');
});

test('learn：从录制里抽集合/能力，登录步既不进孪生也不进案例', async (t) => {
  const fx = await startFixture();
  const out = tmpDir('learn');
  const tap = startTap({ target: fx.url, port: 18922, out, quiet: true });
  t.after(async () => { await tap.stop(); await fx.close(); });
  const login = await (await fetch(tap.url + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'dev', password: 'pw-dev' }),
  })).json();
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + login.token };
  await fetch(tap.url + '/api/tasks', { headers: H });
  for (const title of ['a', 'b', 'c']) {
    await fetch(tap.url + '/api/tasks', { method: 'POST', headers: H, body: JSON.stringify({ title }) });
  }
  await fetch(tap.url + '/api/tasks/1/complete', { method: 'POST', headers: H });
  await fetch(tap.url + '/api/tasks', { headers: H });
  await fetch(tap.url + '/api/users', { headers: H });
  await tap.stop();

  const learned = learnTraffic(readTraffic(path.join(out, 'traffic.jsonl')));
  assert.deepEqual([...learned.collections.keys()].sort(), ['tasks', 'users']);
  assert.ok(learned.capabilities['tasks.create']);
  assert.ok(learned.roles.length >= 1);

  const twin = buildTwin(learned);
  assert.ok(!twin.steps.some((s) => /^login[.]/.test(s.capability)), '孪生不该含登录步');
  assert.deepEqual(twin.steps.map((s) => s.capability), ['tasks.create', 'tasks.create', 'tasks.create', 'tasks.complete']);

  const cases = buildCases(learned, twin, { name: 'fixture' });
  assert.equal(cases.length, 1);
  assert.deepEqual(validateCase(cases[0]), []);
  assert.equal(cases[0].draft.status, 'unconfirmed', '默认必须是草稿，得人确认才出判决');
  assert.deepEqual(cases[0].task.goal_assertions, [
    { kind: 'count_delta', selector: { collection: 'tasks' }, delta: 3 },
  ]);
  const spec = emitSpec(learned, { name: 'fixture' });
  assert.equal(spec.evidence, 'inferred');
  assert.equal(spec.view.tasks.from, 'GET /api/tasks');
  assert.ok(spec.view.tasks.fields.id);
});

test('decl 适配器：登录→观测→执行，{items:[…]} 包裹能认出来', async () => {
  const fx = await startFixture();
  try {
  const spec = parseYaml([
    'adapter: fixture',
    'version: 1.0.0',
    'evidence: inferred',
    'base_url:',
    '  value: ' + fx.url,
    'roles:',
    '  - dev',
    'auth:',
    '  login: POST /login',
    '  user_field: username',
    '  pass_field: password',
    '  token: $.token',
    '  accounts:',
    '    dev:',
    '      user: dev',
    '      pass: pw-dev',
    'capabilities:',
    '  tasks.create:',
    '    POST: /api/tasks',
    '    as:',
    '      - dev',
    '    args:',
    '      title: $.title',
    'view:',
    '  tasks:',
    '    from: GET /api/tasks',
    '    fields:',
    '      id: $.id',
    '      title: $.title',
    '      done: $.done',
  ].join('\n'));
  const adapter = createAdapterFromSpec(spec);
  const m = await adapter.manifest();
  assert.deepEqual(m.scopes, ['tasks']);
  const reset = await adapter.reset();
  assert.deepEqual(reset.state.tasks, []);
  const created = await adapter.execute('r1', { capability: 'tasks.create', arguments: { title: 'x' }, as: 'dev' });
  assert.equal(created.outcome, 'applied');
  const obs = await adapter.observe();
  assert.equal(obs.state.tasks.length, 1, '{items:[…]} 必须被认成集合，而不是单行');
  assert.equal(obs.state.tasks[0].title, 'x');
  assert.deepEqual(obs.missingScopes, []);
  } finally {
    await fx.close();
  }
});

test('孪生适配器：按录制顺序回放，错序与参数不符都不装作成功', async () => {
  const twin = {
    version: 'agent-web/twin-1',
    roles: ['dev'],
    collections: ['tasks'],
    capabilities: ['tasks.create'],
    initial: { tasks: [] },
    final: { tasks: [{ id: 1, title: 'x', done: false }] },
    steps: [{
      capability: 'tasks.create',
      body: { title: 'x' },
      outcome: 'applied',
      delta: { tasks: [{ id: 1, title: 'x', done: false }] },
    }],
  };
  const adapter = createTwinAdapter(twin);
  const m = await adapter.manifest();
  assert.deepEqual(m.view.collections.tasks.required, ['done', 'id', 'title']);
  await adapter.reset();
  const wrong = await adapter.execute('r', { capability: 'tasks.delete', arguments: {}, as: 'dev' });
  assert.equal(wrong.outcome, 'unsupported');
  assert.equal(wrong.error.code, 'out_of_order');
  const mismatch = await adapter.execute('r', { capability: 'tasks.create', arguments: { title: 'y' }, as: 'dev' });
  assert.equal(mismatch.error.code, 'args_mismatch');
  const ok = await adapter.execute('r', { capability: 'tasks.create', arguments: { title: 'x' }, as: 'dev' });
  assert.equal(ok.outcome, 'applied');
  const obs = await adapter.observe();
  assert.equal(obs.state.tasks.length, 1);
  const exhausted = await adapter.execute('r', { capability: 'tasks.create', arguments: { title: 'x' }, as: 'dev' });
  assert.equal(exhausted.error.code, 'twin_exhausted');
});

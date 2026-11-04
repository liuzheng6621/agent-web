import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DISCOVER_VERSION,
  OPENAPI_CANDIDATES,
  toCapabilityId,
  capabilityKind,
  parseOpenApi,
  probeSite,
  pickReadEndpoints,
  buildAdapterSource,
  buildCaseDocs,
  runReads,
  discover,
  synthesizeBody,
  writePlanOf,
  buildWriteCases,
} from '../src/discover.mjs';
import { validateCase, draftBlocker, acceptCase } from '../src/case.mjs';
import { validateManifest } from '../src/adapter/contract.mjs';

const ORDERS = [
  { id: 1, status: 'PENDING', total: 56 },
  { id: 2, status: 'READY', total: 28 },
];
const MENU = [{ id: 1, name: '拿铁', price: 28 }];

function spec() {
  return {
    openapi: '3.0.0',
    info: { title: '演示订单服务', version: '1.0.0' },
    paths: {
      '/api/orders': { get: {}, post: {} },
      '/api/orders/{id}': { get: {}, delete: {}, put: {} },
      '/api/menu': { get: {} },
      '/api/menu/{id}/image': { post: {} },
    },
  };
}

// 一个有 OpenAPI、也有真实响应的最小站点
function serve({ withSpec = true } = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = req.url.split('?')[0];
      const json = (o) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(o));
      };
      if (withSpec && u === '/openapi.json') return json(spec());
      if (u === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end('<html><head><title>演示订单服务</title></head><body>ok</body></html>');
      }
      if (u === '/api/orders') return json(ORDERS);
      if (u === '/api/menu') return json(MENU);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"code":404}');
    });
    srv.listen(0, '127.0.0.1', () => {
      const base = 'http://127.0.0.1:' + srv.address().port;
      resolve({ srv, base });
    });
  });
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-web-discover-'));
}

test('discover 产物自带施工单 NEXT.md 与 TODO 标记', async () => {
  const { discover } = await import('../src/discover.mjs');
  const { readFileSync, existsSync, rmSync } = await import('node:fs');
  const http = await import('node:http');
  const srv = http.createServer((req, res) => {
    if (req.url === '/openapi.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ openapi: '3.0.0', info: { title: 't' }, paths: {
        '/api/items': { get: { summary: 'list' }, post: { summary: 'create' } },
      } }));
    }
    if (req.url === '/api/items') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('[]'); }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((r) => srv.listen(18195, '127.0.0.1', r));
  rmSync('.tmp-next', { recursive: true, force: true });
  const rep = await discover('http://127.0.0.1:18195', { outDir: '.tmp-next', run: true });
  assert.equal(existsSync('.tmp-next/NEXT.md'), true);
  const next = readFileSync('.tmp-next/NEXT.md', 'utf8');
  for (const h of ['1 能力表与角色', '2 返回口径', '3 规范视图', '4 隔离', '填完之后']) {
    assert.equal(next.includes(h), true, 'NEXT.md 缺章节 ' + h);
  }
  const src = readFileSync('.tmp-next/adapter.mjs', 'utf8');
  for (const m of ['TODO(1)', 'TODO(2)', 'TODO(3)', 'TODO(4)']) {
    assert.equal(src.includes(m), true, 'adapter 缺标记 ' + m);
  }
  assert.equal(rep.written.some((f) => f.endsWith('NEXT.md')), true);
  srv.closeAllConnections(); srv.close();
});
test('能力 id：从路径和动词推出来，末段是名字时用它当动作', () => {
  assert.equal(toCapabilityId('get', '/api/orders'), 'orders.list');
  assert.equal(toCapabilityId('get', '/api/orders/{id}'), 'orders.get');
  assert.equal(toCapabilityId('post', '/api/orders'), 'orders.create');
  assert.equal(toCapabilityId('put', '/api/orders/{id}'), 'orders.update');
  assert.equal(toCapabilityId('delete', '/api/orders/{id}'), 'orders.delete');
  // 末段是名字，不该被叫成 create —— 否则和「新建菜单」撞名
  assert.equal(toCapabilityId('post', '/api/menu/{id}/image'), 'menu.image');
  assert.equal(capabilityKind('GET'), 'read');
  assert.equal(capabilityKind('POST'), 'write');
});

test('parseOpenApi：只认 paths，去重排序，产出 http 字段', () => {
  const parsed = parseOpenApi(spec(), 'http://x');
  const ids = parsed.capabilities.map((c) => c.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(parsed.capabilities.every((c) => typeof c.http === 'string' && c.http.includes(' ')));
  assert.equal(parsed.capabilities.find((c) => c.id === 'orders.get').kind, 'read');
});

test('probeSite：找到 OpenAPI 就报 openapi，找不到就报 none', async () => {
  const a = await serve({ withSpec: true });
  try {
    const r = await probeSite(a.base, { timeoutMs: 3000 });
    assert.equal(r.reachable, true);
    assert.ok(r.openapi, '应该找到 openapi');
    assert.ok(r.openapi.capabilities.length >= 5);
    assert.equal(r.root.title, '演示订单服务');
  } finally {
    a.srv.close();
  }

  const b = await serve({ withSpec: false });
  try {
    const r = await probeSite(b.base, { timeoutMs: 3000 });
    assert.equal(r.reachable, true);
    assert.equal(r.openapi, null);
  } finally {
    b.srv.close();
  }
});

test('probeSite：连不上时 reachable=false 且不抛', async () => {
  const r = await probeSite('http://127.0.0.1:1', { timeoutMs: 500 });
  assert.equal(r.reachable, false);
  assert.ok(r.failures.length > 0);
});

test('生成的适配器能 import，五方法齐、manifest 通过校验、能力全标 inferred', async () => {
  const caps = parseOpenApi(spec(), 'http://x').capabilities;
  const dir = tmpdir();
  const file = path.join(dir, 'adapter.mjs');
  fs.writeFileSync(file, buildAdapterSource({ adapterName: 'demo', baseUrl: 'http://x', capabilities: caps, generatedAt: 'now' }), 'utf8');

  const mod = await import(pathToFileURL(file).href);
  const adapter = mod.createAdapter();
  for (const m of ['manifest', 'reset', 'observe', 'execute', 'close']) {
    assert.equal(typeof adapter[m], 'function', '缺方法 ' + m);
  }
  const manifest = await adapter.manifest();
  assert.deepEqual(validateManifest(manifest), []);
  assert.ok(manifest.capabilities.every((c) => c.evidence_level === 'inferred'));
  assert.equal(manifest.reset_strategy, 'identity');

  // 写能力必须是 unsupported：机器不猜业务
  const r = await adapter.execute('r1', { capability: 'orders.create', arguments: {}, as: 'viewer' });
  assert.equal(r.outcome, 'unsupported');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pickReadEndpoints：每个资源挑一个不带参数的 GET', () => {
  const caps = parseOpenApi(spec(), 'http://x').capabilities;
  const reads = pickReadEndpoints(caps);
  assert.deepEqual(Object.keys(reads).sort(), ['menu', 'orders']);
  assert.equal(reads.orders.path, '/api/orders');
});

test('生成的案例通过格式校验，且默认是草稿；确认后才放行', () => {
  const caps = parseOpenApi(spec(), 'http://x').capabilities;
  const docs = buildCaseDocs({ adapterName: 'demo', baseUrl: 'http://x', capabilities: caps });
  assert.ok(docs.length >= 2);
  for (const doc of docs) {
    assert.deepEqual(validateCase(doc), []);
    assert.ok(draftBlocker(doc), ' 新生成的必须是草稿');
  }
  const ok = acceptCase(JSON.parse(JSON.stringify(docs[0])), { by: 'YG' });
  assert.equal(draftBlocker(ok), null);
});

test('discover 端到端：生成文件、实跑只读接口、带参数的跳过而不是伪造失败', async () => {
  const { srv, base } = await serve({ withSpec: true });
  const out = tmpdir();
  try {
    const report = await discover(base, { outDir: out, run: true, timeoutMs: 3000 });
    assert.equal(report.source, 'openapi');
    assert.ok(report.written.length >= 2);
    assert.ok(fs.existsSync(path.join(out, 'adapter.mjs')));

    const byId = Object.fromEntries(report.reads.map((r) => [r.id, r]));
    assert.equal(byId['orders.list'].ok, true);
    assert.equal(byId['orders.list'].rows, 2);
    assert.equal(byId['menu.list'].ok, true);
    // 带 {id} 的接口拿不到真实 id，必须标 skipped，不能拼个假路径去打出 404
    assert.equal(byId['orders.get'].skipped, '需要路径参数');
    assert.equal(byId['orders.get'].status, 0);
  } finally {
    srv.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('discover 没找到接口描述时，不生成任何文件，并把下一步说清楚', async () => {
  const { srv, base } = await serve({ withSpec: false });
  const out = tmpdir();
  try {
    const report = await discover(base, { outDir: out, run: true, timeoutMs: 3000 });
    assert.equal(report.reachable, true);
    assert.equal(report.source, 'none');
    assert.equal(report.written.length, 0);
    assert.ok(report.limits.some((l) => l.includes('机器可读')));
    assert.equal(fs.existsSync(path.join(out, 'adapter.mjs')), false);
  } finally {
    srv.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('runReads 只打只读接口，写接口一次都不发', async () => {
  const { srv, base } = await serve({ withSpec: true });
  try {
    const caps = parseOpenApi(spec(), base).capabilities;
    const results = await runReads(base, caps, { timeoutMs: 3000 });
    assert.ok(results.length > 0);
    assert.ok(results.every((r) => caps.find((c) => c.id === r.id).kind === 'read'));
  } finally {
    srv.close();
  }
});

test('版本号与候选位置是常量，别被随手改掉', () => {
  assert.equal(DISCOVER_VERSION, 'agent-web/discover-1');
  assert.ok(OPENAPI_CANDIDATES.includes('/openapi.json'));
  assert.ok(OPENAPI_CANDIDATES.length >= 5);
});

// ---------------------------------------------------------------------------
// 写操作：能机械推的只有往返语义
// ---------------------------------------------------------------------------

test('synthesizeBody：照着 schema 造出形状对的请求体，不造业务数据', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      amount: { type: 'number' },
      tags: { type: 'array', items: { type: 'string' } },
      status: { enum: ['A', 'B'] },
      withDefault: { type: 'integer', default: 7 },
    },
  };
  const body = synthesizeBody(schema);
  assert.equal(typeof body.title, 'string');
  assert.equal(typeof body.amount, 'number');
  assert.deepEqual(body.tags, ['x']);
  assert.equal(body.status, 'A');
  assert.equal(body.withDefault, 7);
});

test('synthesizeBody：$ref 能顺着 components 解开，解不开就返回 null', () => {
  const components = { Item: { type: 'object', properties: { n: { type: 'integer' } } } };
  const body = synthesizeBody({ type: 'object', properties: { item: { $ref: '#/components/schemas/Item' } } }, 0, components);
  assert.equal(body.item.n, 1);
  const missing = synthesizeBody({ $ref: '#/components/schemas/Nope' }, 0, components);
  assert.equal(missing, null);
});

test('writePlanOf：只给 create 出计划，delete/update 要真实实体才能打所以不出', () => {
  const parsed = parseOpenApi(spec(), 'http://127.0.0.1:1');
  const plan = writePlanOf(parsed.capabilities, spec());
  assert.deepEqual(Object.keys(plan), ['orders.create'], '只该有 create');
  assert.equal(plan['orders.create'].method, 'POST');
  assert.equal(plan['orders.create'].path, '/api/orders');
});

test('writePlanOf：没有 requestBody 时 body 为 null，不编一个假请求体', () => {
  const doc = spec();
  const parsed = parseOpenApi(doc, 'http://127.0.0.1:1');
  const plan = writePlanOf(parsed.capabilities, doc);
  assert.equal(plan['orders.create'].body, null);
});

test('buildWriteCases：默认草稿；断言只有一条 count_delta；body 从 schema 来', () => {
  const doc = spec();
  doc.paths['/api/orders'].post = {
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'number' } } } } } },
  };
  const parsed = parseOpenApi(doc, 'http://127.0.0.1:1');
  const plan = writePlanOf(parsed.capabilities, doc);
  const [draftCase] = buildWriteCases({ adapterName: 'site', baseUrl: 'http://127.0.0.1:1', capabilities: parsed.capabilities, writePlan: plan });
  assert.equal(validateCase(draftCase).length, 0, JSON.stringify(validateCase(draftCase)));
  assert.equal(draftBlocker(draftCase).status, 'unconfirmed');
  assert.deepEqual(draftCase.task.goal_assertions.map((a) => a.kind), ['count_delta']);
  assert.equal(draftCase.task.goal_assertions[0].delta, 1);
  assert.equal(draftCase.reference_trajectory[0].arguments.body.total, 1);
  const accepted = acceptCase(JSON.parse(JSON.stringify(draftCase)), { by: 'YG' });
  assert.equal(accepted.draft.status, 'confirmed');
});

test('写案例真的能判：写完多一条就 pass，只是回了 200 没写就 fail', async () => {
  const { judge } = await import('../src/runner.mjs');
  const { loadAdapter } = await import('../src/adapter/load.mjs');
  const doc = {
    openapi: '3.0.0',
    info: { title: '写夹具', version: '1.0.0' },
    paths: { '/api/orders': { get: {}, post: {} } },
  };
  const makeServer = (append) => {
    const rows = [{ id: 1 }];
    const server = http.createServer((req, res) => {
      if (req.url === '/api/orders' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(rows));
        return;
      }
      if (req.url === '/api/orders' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (append) rows.push({ id: rows.length + 1 });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{}');
        });
        return;
      }
      res.writeHead(404);
      res.end('{}');
    });
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
  };

  const good = await makeServer(true);
  const bad = await makeServer(false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-w-'));

  const run = async (server) => {
    const base = 'http://127.0.0.1:' + server.address().port;
    const parsed = parseOpenApi(doc, base);
    const plan = writePlanOf(parsed.capabilities, doc);
    const source = buildAdapterSource({ adapterName: 'w', baseUrl: base, capabilities: parsed.capabilities, generatedAt: new Date().toISOString(), writePlan: plan });
    const file = path.join(dir, 'adapter-' + server.address().port + '.mjs');
    fs.writeFileSync(file, source, 'utf8');
    const [caseObj] = buildWriteCases({ adapterName: 'w', baseUrl: base, capabilities: parsed.capabilities, writePlan: plan, confirmedBy: 'YG' });
    const adapter = await loadAdapter(file, {}, process.cwd());
    const verdict = await judge({ case: caseObj, adapter, adapterName: 'w' });
    await adapter.close();
    return verdict;
  };

  const ok = await run(good);
  const broken = await run(bad);
  // fetch 用 keep-alive 连接池，光 close() 会一直等空闲 socket 断开，测试就挂住了。
  for (const server of [good, bad]) {
    server.closeAllConnections();
    server.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(ok.status, 'pass', JSON.stringify(ok.reason));
  assert.equal(broken.status, 'fail');
  assert.equal(broken.reason_code, 'assertion_false');
});

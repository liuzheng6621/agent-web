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

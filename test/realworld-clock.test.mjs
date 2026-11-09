// 这条守卫是为了一个只在 CI 上出现过一次的失败：realworld/pagination 判 fail。
//
// 根因：夹具 A 用 `new Date().toISOString()` 取真实毫秒，两次创建落在同一毫秒时
// createdAt 相等；列表按 createdAt 倒序，相等时 sort 退化成插入序，
// 「翻页拿到刚建的那条」就错一页。本地两次 HTTP 往返超过 1ms，所以本地永远不复现。
//
// 修法不是让案例宽容，而是让夹具的时钟单调（B 早就是这么做的）。
// 这条测试把时钟钉死，于是「同毫秒」从偶发变成必然 —— 没修就一定红，修了才绿。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'agent-web.mjs');
const A_SRV = path.join(ROOT, 'examples', 'realworld', 'fake-server.mjs');
const PORT = 8331;
const FROZEN = '1700000000000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(port, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    const r = await fetch(`http://127.0.0.1:${port}/api/tags`).catch(() => null);
    if (r && r.ok) return true;
    await sleep(200);
  }
  return false;
}

test('夹具时钟单调：钉死毫秒后连建三条仍严格递增，pagination 仍判 pass', async (t) => {
  const srv = spawn(process.execPath, [A_SRV, String(PORT), '--allow-reset'], {
    cwd: ROOT,
    env: { ...process.env, REALWORLD_FIXTURE_FROZEN_MS: FROZEN },
    stdio: 'ignore',
  });
  t.after(() => { srv.kill(); });

  assert.ok(await waitUp(PORT), '夹具没起来');

  const api = `http://127.0.0.1:${PORT}/api`;
  const call = async (method, p, body, tok) => {
    const r = await fetch(api + p, {
      method,
      headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Token ${tok}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const uid = `clock_${Date.now()}`;
  await call('POST', '/users', { user: { username: uid, email: `${uid}@t.com`, password: 'password123' } });
  const login = await call('POST', '/users/login', { user: { email: `${uid}@t.com`, password: 'password123' } });
  const tok = login.body.user.token;

  const stamps = [];
  for (let i = 1; i <= 3; i += 1) {
    const r = await call('POST', '/articles', { article: { title: `Clock ${i} ${uid}`, description: 'd', body: 'b' } }, tok);
    assert.equal(r.status, 201, `第 ${i} 条没建成`);
    stamps.push(r.body.article.createdAt);
  }

  // 先把「钉死」本身钉住：夹具必须真的吃这个开关，否则下面那条断言会因为
  // 用的是真实时钟而白白通过（这正是第一版守卫的漏洞 —— 旧代码也能过）。
  assert.equal(stamps[0], new Date(Number(FROZEN)).toISOString(),
    `夹具没吃 REALWORLD_FIXTURE_FROZEN_MS，第一个时间戳是 ${stamps[0]} 而不是冻结值`);

  // 时钟被钉死，所以这三次调用「真实时间」完全一样。
  assert.equal(new Set(stamps).size, 3, `同一毫秒内建三条必须拿到三个不同时间戳，实际 ${JSON.stringify(stamps)}`);
  assert.deepEqual([...stamps].sort(), stamps, '时间戳必须严格递增（否则倒序排序会退化成插入序）');

  // 端到端：pagination 案例靠「翻页拿到刚建的那条」，时钟不单调就会错一页。
  const r = spawnSync(process.execPath, [CLI, 'verify', 'cases/realworld/pagination.json', '--adapter=realworld'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, REALWORLD_BASE_URL: `http://127.0.0.1:${PORT}` },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  assert.equal(r.status, 0, `pagination 在冻结时钟下应判 pass，实际：\n${out}`);
  assert.match(out, /pass\s+realworld\/pagination/);
});

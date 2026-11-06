// 第五个域的门槛是「两份独立实现 + compare 100% 一致」。
// 这个测试同时证明两件事：
//   1) 两份实现真的能跑出同一个判决（否则它们不是同一份契约的实现）
//   2) 把其中一份弄坏，对照能看见（否则 100% 只是案例在睡觉）
//
// 第二条比第一条重要。只验第一条的话，一个什么都不做的适配器也能过。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'agent-web.mjs');
const A_SRV = path.join(ROOT, 'examples', 'realworld', 'fake-server.mjs');
const B_SRV = path.join(ROOT, 'examples', 'realworld', 'fake-server-b.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp(port, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    const r = await fetch(`http://127.0.0.1:${port}/api/tags`).catch(() => null);
    if (r && r.ok) return true;
    await sleep(200);
  }
  return false;
}

function startServer(file, port, env = {}) {
  const p = spawn(process.execPath, [file, String(port), '--allow-reset'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  return p;
}

function compare(aPort, bPort, target = 'cases/realworld') {
  const r = spawnSync(process.execPath, [CLI, 'compare', target, '--adapters=realworld,realworld-b'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      REALWORLD_BASE_URL: `http://127.0.0.1:${aPort}`,
      REALWORLD_B_BASE_URL: `http://127.0.0.1:${bPort}`,
    },
  });
  return { rc: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

test('两份实现判决一致，且弄坏一份之后对照能看见', async (t) => {
  const a = startServer(A_SRV, 8301);
  const b = startServer(B_SRV, 8302);
  t.after(() => { a.kill(); b.kill(); });

  assert.ok(await waitUp(8301), '实现 A 没起来');
  assert.ok(await waitUp(8302), '实现 B 没起来');

  const good = compare(8301, 8302);
  assert.equal(good.rc, 0, `一致时应当退出 0，实际 ${good.rc}\n${good.out}`);
  assert.match(good.out, /跨适配器判决一致率 100\.0%/);
  assert.doesNotMatch(good.out, /✗/);

  // 弄坏 B：把文章列表反成最旧在前。它只违反「按创建时间倒序」这一条契约。
  const bad = startServer(B_SRV, 8303, { REALWORLD_B_BUG: 'order' });
  t.after(() => bad.kill());
  assert.ok(await waitUp(8303), '带故障的实现 B 没起来');

  const broken = compare(8301, 8303, 'cases/realworld/pagination.json');
  assert.equal(broken.rc, 1, '有判决分歧时应当退出 1');
  assert.match(broken.out, /✗/);
  assert.match(broken.out, /pass vs fail/);
});

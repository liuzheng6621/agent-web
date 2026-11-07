import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN = path.join(ROOT, 'bin', 'agent-web.mjs');

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AGENT_WEB_QUIET_ADAPTER_WARNING: '1' },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// 一份「读案例之后才会发现」的坏 manifest，正是这条改动要拦的东西。
const BAD = `export function createAdapter() {
  return {
    async manifest() { return { adapter: 'bad', reset_strategy: 'identity' }; },
    async reset() { return { runId: 'r', state: {}, roleBindings: {} }; },
    async observe() { return { state: {} }; },
    async execute() { return { outcome: 'applied' }; },
    async close() {},
  };
}
`;

function withBadAdapter(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-precheck-'));
  const file = path.join(dir, 'bad.mjs');
  fs.writeFileSync(file, BAD, 'utf8');
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('坏 manifest 在读案例之前就退 2，不是跑完再报 invalid_environment', () => {
  withBadAdapter((file) => {
    const r = run(['verify', 'cases/cron', `--adapter=${file}`]);
    assert.equal(r.code, 2);
    // 关键证据：错误信息里没有出现任何一条案例的 id。
    // 一旦出现，说明案例已经被读过了 —— 校验时机又滑回 judge() 里了。
    assert.ok(!r.stderr.includes('cron/recurrence'), '不该读到案例');
    assert.ok(r.stderr.includes('manifest 没通过校验'));
  });
});

test('校验信息指名道姓：第几条、哪个字段', () => {
  withBadAdapter((file) => {
    const r = run(['verify', 'cases/cron', `--adapter=${file}`]);
    assert.ok(r.stderr.includes('manifest.adapter_version 必填'));
    assert.ok(r.stderr.includes('manifest.capabilities 必须是非空数组'));
    assert.ok(/共 3 条/.test(r.stderr), '要给出总数，否则不知道还有几条没看');
  });
});

test('说清这不是环境坏了：否则读者会把声明错误当成事故去查环境', () => {
  withBadAdapter((file) => {
    const r = run(['verify', 'cases/cron', `--adapter=${file}`]);
    assert.ok(r.stderr.includes('这不是环境坏了，是声明写错了'));
  });
});

test('certify 与 compare 同样在碰案例前拦住', () => {
  withBadAdapter((file) => {
    const c = run(['certify', 'cases/cron', `--adapter=${file}`]);
    assert.equal(c.code, 2);
    assert.ok(!c.stdout.includes('变异体'), 'certify 不该跑到变异体阶段');
    const m = run(['compare', 'cases/cron', `--adapters=${file},cron-a`]);
    assert.equal(m.code, 2);
  });
});

test('好 manifest 不受影响：cron-a 照旧跑通', () => {
  const r = run(['verify', 'cases/cron', '--adapter=cron-a']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.includes('100.0% (3/3)'));
});

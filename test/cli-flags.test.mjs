import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'agent-web.mjs');
const STUB = path.join(ROOT, 'test', 'fixtures', 'adapter-stub.mjs');

const run = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: ROOT, encoding: 'utf8' });

test('--adapter 必须真的改变被加载的适配器（曾经被无视）', () => {
  // 桩适配器一被加载就抛 STUB_ADAPTER_USED：能看到这句话，就说明 flag 生效了。
  const r = run(['selftest', '--adapter=test/fixtures/adapter-stub.mjs']);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /STUB_ADAPTER_USED/, '--adapter 指定了桩适配器，但它没被加载 —— flag 又被无视了');
  assert.notEqual(r.status, 0);
});

test('不传 --adapter 时仍然用内存适配器', () => {
  const r = run(['verify', 'cases/coffee/happy-path.json']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /pass/);
});

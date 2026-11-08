import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

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

test('version 子命令兑现承诺：版本、最近变更、三处一致（机器可判）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const r = run(['version']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, new RegExp(`^${pkg.name} ${pkg.version}$`, 'm'));
  assert.match(r.stdout, /最近一次变更/);
  assert.match(r.stdout, /版本号三处/);
  assert.match(r.stdout, /→ 一致/);
});

test('version --json 输出三处对账且 consistent 为真', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const r = run(['version', '--json']);
  assert.equal(r.status, 0, r.stdout);
  const j = JSON.parse(r.stdout);
  assert.equal(j.version, pkg.version);
  assert.equal(j.versionFile, pkg.version);
  assert.equal(j.changelogVersion, pkg.version);
  assert.equal(j.consistent, true);
});

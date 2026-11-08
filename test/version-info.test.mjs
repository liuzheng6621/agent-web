import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectVersionInfo } from '../src/version-info.mjs';

function fixture({ version = '1.2.3', changelog = '## 1.2.3 — 2026-01-02\n\n- 改了什么\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-version-'));
  if (version !== null) fs.writeFileSync(path.join(root, 'VERSION'), version + '\n');
  if (changelog !== null) fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  return root;
}

test('三处一致：package.json / VERSION 文件 / CHANGELOG 首条', () => {
  const info = collectVersionInfo({ root: fixture(), pkgVersion: '1.2.3' });
  assert.equal(info.consistent, true, JSON.stringify(info.problems));
  assert.deepEqual(info.problems, []);
  assert.equal(info.versionFile, '1.2.3');
  assert.equal(info.changelogVersion, '1.2.3');
  assert.equal(info.changelogHead, '1.2.3 — 2026-01-02');
  assert.equal(info.latestSummary, '改了什么');
});

test('VERSION 文件与 package.json 不一致 → 判不一致并给退出可用的 problems', () => {
  const info = collectVersionInfo({ root: fixture({ version: '9.9.9' }), pkgVersion: '1.2.3' });
  assert.equal(info.consistent, false);
  assert.ok(info.problems.some((p) => p.includes('VERSION 文件 9.9.9') && p.includes('package.json 1.2.3')));
});

test('CHANGELOG 首条与 package.json 不一致 → 判不一致', () => {
  const info = collectVersionInfo({ root: fixture({ changelog: '## 9.9.9 — 2026-01-02\n\n- 旧条目\n' }), pkgVersion: '1.2.3' });
  assert.equal(info.consistent, false);
  assert.ok(info.problems.some((p) => p.includes('CHANGELOG 首条 9.9.9')));
});

test('VERSION 文件缺失 → 问题入册，不静默通过', () => {
  const info = collectVersionInfo({ root: fixture({ version: null }), pkgVersion: '1.2.3' });
  assert.equal(info.consistent, false);
  assert.ok(info.problems.some((p) => p.includes('VERSION 文件不存在')));
});

test('CHANGELOG 无「## x.y.z」首条 → 问题入册', () => {
  const info = collectVersionInfo({ root: fixture({ changelog: '# 变更日志\n随便写写\n' }), pkgVersion: '1.2.3' });
  assert.equal(info.consistent, false);
  assert.ok(info.problems.some((p) => p.includes('没有「## x.y.z」')));
});

test('CRLF 的 CHANGELOG 也能解析（本仓库 CHANGELOG.md 就是 CRLF）', () => {
  const info = collectVersionInfo({
    root: fixture({ changelog: '## 1.2.3 — 2026-01-02\r\n\r\n- CRLF 条目\r\n' }),
    pkgVersion: '1.2.3',
  });
  assert.equal(info.consistent, true, JSON.stringify(info.problems));
  assert.equal(info.changelogHead, '1.2.3 — 2026-01-02');
  assert.equal(info.latestSummary, 'CRLF 条目');
});

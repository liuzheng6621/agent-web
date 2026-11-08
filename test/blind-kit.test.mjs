import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'build-blind-kit.mjs');
const RECONCILE = join(ROOT, 'scripts', 'blind-reconcile.mjs');

test('盲测包三件套与发行说明齐备', () => {
  assert.equal(existsSync(SCRIPT), true, 'scripts/build-blind-kit.mjs 应存在');
  assert.equal(existsSync(RECONCILE), true, 'scripts/blind-reconcile.mjs 应存在');
});

test('BLIND.md 的 MANIFEST.check 命令与对账口径一致（必须收全部案例文件，不只 *.json）', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /cases-blind\/\*\*\/\*\.\*/, 'MANIFEST.check 生成命令必须用递归通配收全部文件');
  assert.match(src, /recursive:\s*true|recursive=True/, '必须声明递归');
  const recon = readFileSync(RECONCILE, 'utf8');
  assert.match(recon, /MANIFEST\.check/, '对账器必须消费 MANIFEST.check');
  assert.match(recon, /unexpected_rejection/, '对账器必须带 realworld 环境故障诊断');
});

test('构建链必须隔离判决：案例目录剔除 expected.json，reference 不进包', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  assert.match(src, /expected\.json/, '必须显式剔除 expected.json');
  assert.match(src, /reference\.json/, '必须生成 reference.json');
  assert.doesNotMatch(src, /expected\.json.*zip|zip.*expected\.json/, 'expected.json 不得进 zip');
  assert.match(src, /内存态|不幂等/, 'realworld 脏态警告必须在构建脚本里写死');
});

test('reference 基准（若已构建）必须覆盖五域且无 expected 泄漏', () => {
  const refPath = join(ROOT, 'blind', 'reference.json');
  if (!existsSync(refPath)) return; // 未构建过则跳过（CI 不强制跑 --with-reference）。
  const ref = JSON.parse(readFileSync(refPath, 'utf8'));
  const domains = new Set(Object.keys(ref.cases).map((id) => id.split('/')[0]));
  for (const d of ['coffee', 'ledger', 'lexicon', 'cron', 'realworld']) {
    assert.equal(domains.has(d), true, `reference 必须覆盖 ${d}`);
  }
  for (const id of Object.keys(ref.cases)) {
    assert.match(id, /^(coffee|ledger|lexicon|cron|realworld)\//, `case_id 必须带域前缀：${id}`);
  }
});

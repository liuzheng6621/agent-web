#!/usr/bin/env node
/**
 * blind-reconcile —— 盲测回投对账。
 *
 * 输入：盲测者回投的 results/ 目录（或整个 zip）。
 *   - *.jsonl      verify 的原样输出（每行一个案例）
 *   - MANIFEST.check  盲测者按 BLIND.md 生成的案例哈希清单（防改断言）
 * 基准：blind/reference.json（构建盲测包时本地跑出来的 {case_id → 判决}）。
 *
 * 用法：node scripts/blind-reconcile.mjs <results目录或zip路径> [--manifest=<原包路径>]
 */
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];
if (!arg) {
  console.error('用法: node scripts/blind-reconcile.mjs <results目录或zip路径> [--manifest=<原盲测包根>]');
  process.exit(2);
}
const ref = JSON.parse(readFileSync(join(ROOT, 'blind', 'reference.json'), 'utf8'));

// 1) 解包（zip → 临时目录）或直接用目录。
let incoming = resolve(arg);
let cleaned = null;
if (arg.endsWith('.zip')) {
  cleaned = mkdtempSync(join(tmpdir(), 'blind-'));
  execFileSync('python', ['-c', `import zipfile; zipfile.ZipFile(r'${incoming}').extractall(r'${cleaned}')`]);
  incoming = cleaned;
}
// 兼容两种回投形态：直接是 results/，或包根下含 results/。
const resultsDir = existsSync(join(incoming, 'results')) ? join(incoming, 'results') : incoming;

// 2) 读回投判决。
const got = {};
for (const f of readdirSync(resultsDir)) {
  if (!f.endsWith('.jsonl')) continue;
  for (const line of readFileSync(join(resultsDir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    got[row.case_id] = { verdict: row.status, reason_code: row.reason_code ?? null, file: f };
  }
}

// 3) MANIFEST 校验：回投者跑的案例必须与发行版逐文件一致。
const manifestPath = join(resultsDir, 'MANIFEST.check');
let manifestOk = null;
if (existsSync(manifestPath) && process.argv.find((a) => a.startsWith('--manifest='))) {
  const kitRoot = resolve(process.argv.find((a) => a.startsWith('--manifest=')).slice('--manifest='.length));
  const shipped = new Map(
    readFileSync(join(kitRoot, 'MANIFEST.sha256'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('  cases-blind/'))
      .map((l) => [l.split('  ')[1], l.split('  ')[0]]),
  );
  const theirs = readFileSync(manifestPath, 'utf8');
  let mismatches = 0;
  for (const [rel, sha] of shipped) {
    if (!theirs.includes(sha)) mismatches++;
  }
  manifestOk = mismatches === 0;
  console.log(`MANIFEST 校验: ${manifestOk ? '一致' : `${mismatches}/${shipped.size} 个文件哈希对不上（案例被改动，回投无效）`}`);
} else {
  console.log('MANIFEST 校验: 跳过（缺 MANIFEST.check 或 --manifest）');
}

// 4) 逐案例对账。
const agree = [];
const disagree = [];
const unknowns = [];
const missing = [];
for (const [caseId, refRow] of Object.entries(ref.cases)) {
  const g = got[caseId];
  if (!g) {
    missing.push(caseId);
    continue;
  }
  if (g.verdict === refRow.verdict) {
    agree.push(caseId);
    if (g.verdict === 'unknown') unknowns.push(caseId);
  } else {
    disagree.push({ caseId, ours: `${refRow.verdict}${refRow.reason_code ? `(${refRow.reason_code})` : ''}`, theirs: `${g.verdict}${g.reason_code ? `(${g.reason_code})` : ''}` });
  }
}
const extra = Object.keys(got).filter((k) => !(k in ref.cases));

// 5) 报告（m/n 形式，不做任何综合评分）。
const n = Object.keys(ref.cases).length;
console.log('');
console.log(`对账基准: reference v${ref.version}（${n} 案例）`);
console.log(`回投判决: ${Object.keys(got).length} 条`);
console.log('');
console.log(`一致: ${agree.length}/${n}`);
if (disagree.length) {
  console.log(`分歧: ${disagree.length}/${n}`);
  for (const d of disagree) console.log(`  - ${d.caseId}: 我们 ${d.ours} / 盲测 ${d.theirs}`);
}
if (unknowns.length) console.log(`unknown（双方同判）: ${unknowns.length}/${n} —— ${unknowns.join(', ')}`);
if (missing.length) console.log(`缺失: ${missing.length}/${n} —— ${missing.join(', ')}`);
if (extra.length) console.log(`回投多出: ${extra.length} —— ${extra.join(', ')}`);

// realworld 诊断：fake-server 有内存态且不幂等——服务没起、或复用了跑过一轮的实例，
// 13 个案例会整域 unexpected_rejection。这是环境故障，不是断言分歧，要求重跑而非宣判。
const rwRejected = disagree.filter((d) => d.caseId.startsWith('realworld/') && d.theirs.includes('unexpected_rejection'));
if (rwRejected.length >= 10) {
  console.log('');
  console.log(`诊断: realworld 域 ${rwRejected.length} 例整域 unexpected_rejection —— 极大概率是 fake-server 没起、或复用了跑过一轮的实例（它有内存态，不幂等）。`);
  console.log('处置: 结束 127.0.0.1:8299 上的旧实例，重起 examples/realworld/fake-server.mjs，只重跑 realworld 一条再回投。');
  if (cleaned) rmSync(cleaned, { recursive: true, force: true });
  process.exit(2);
}
if (cleaned) rmSync(cleaned, { recursive: true, force: true });
process.exit(disagree.length || missing.length ? 1 : 0);

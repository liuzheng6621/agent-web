#!/usr/bin/env node
// 咖啡店规则的第二次声明校验：跑 conftest，把 allow/deny 翻成 agent-web 的三值词汇。
//
// 这不是「新命令」，是 L3 语义层的独立执行器。它不读案例、不碰适配器，
// 只吃 policy/fixtures/*.json，交给 policy/coffee.rego 判。
//
// 用法：
//   node scripts/policy-check.mjs                  # 跑全部 fixture
//   node scripts/policy-check.mjs --json           # 机器读
//   node scripts/policy-check.mjs --conftest PATH  # 指定 conftest（默认 CONFTEST_BIN 或 PATH）
//
// 退出码：0 全部符合预期；1 有 fixture 判反了；2 环境不可用（找不到 conftest 等）。
//
// 为什么不能没有这一层：agent-web 的案例断言是「我写的判据」，
// 这份 fixture 期望是「我按规则另写一遍的判据」。两边独立，才有对照价值。

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const POLICY_DIR = join(ROOT, 'policy');
const FIXTURE_DIR = join(POLICY_DIR, 'fixtures');
const NAMESPACE = 'coffee';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const conftestArg = (() => {
  const i = args.indexOf('--conftest');
  return i >= 0 ? args[i + 1] : null;
})();

function resolveConftest() {
  const cand = conftestArg || process.env.CONFTEST_BIN || 'conftest';
  // Windows 上裸名 conftest 走 PATH；显式路径原样用
  const probe = spawnSync(cand, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return null;
  return { bin: cand, version: (probe.stdout || '').split('\n')[0].trim() };
}

/**
 * 期望来源有两处，缺一不可：
 *   1. 文件名前缀 good- / bad- 是**声明**
 *   2. 文件内的 "expect" 字段（可选）是**细化**，写了就按它比
 * 只有声明没有细化时，bad-* 只要求「有 deny」，不要求是哪条规则 ——
 * 这样策略改规则号不会假红，但改错规则集一定会红（因为另一侧的 fixture 会失去拦截）。
 */
function expectationOf(file, doc) {
  if (doc && typeof doc.expect === 'string') return doc.expect;
  if (basename(file).startsWith('good-')) return 'allow';
  if (basename(file).startsWith('bad-')) return 'deny';
  return null;
}

function runOne(bin, file) {
  const r = spawnSync(bin, ['test', '-p', 'policy', '--namespace', NAMESPACE, file], {
    encoding: 'utf8',
    cwd: ROOT,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.error) return { status: 'unknown', reason: 'exec_error', detail: String(r.error) };
  // conftest: 0=全过, 1=有失败, 2=用法/加载错误
  if (r.status === 0) return { status: 'allow', rules: [] };
  if (r.status === 1) {
    const rules = [...new Set((out.match(/\bR\d+\b/g) || []))].sort();
    return { status: 'deny', rules, detail: out.trim().split('\n').slice(-6).join('\n') };
  }
  return { status: 'unknown', reason: 'conftest_error', detail: out.trim() };
}

function main() {
  const conf = resolveConftest();
  if (!conf) {
    const msg = 'conftest 不可用：装 conftest（单二进制）或用 --conftest 指定路径';
    if (asJson) console.log(JSON.stringify({ ok: false, reason: 'no_conftest', detail: msg }, null, 2));
    else console.error(`✗ ${msg}`);
    process.exit(2);
  }
  if (!existsSync(FIXTURE_DIR)) {
    if (asJson) console.log(JSON.stringify({ ok: false, reason: 'no_fixtures' }, null, 2));
    else console.error('✗ 没有 policy/fixtures/');
    process.exit(2);
  }

  const files = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(FIXTURE_DIR, f));

  const rows = [];
  for (const file of files) {
    let doc = null;
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      rows.push({ file: basename(file), expect: 'parseable', got: 'unparseable', ok: false });
      continue;
    }
    const expect = expectationOf(file, doc);
    if (!expect) {
      rows.push({ file: basename(file), expect: 'declared', got: 'undeclared', ok: false });
      continue;
    }
    const r = runOne(conf.bin, file);
    rows.push({
      file: basename(file),
      expect,
      got: r.status,
      rules: r.rules || [],
      reason: r.reason,
      ok: r.status === expect,
    });
  }

  const bad = rows.filter((x) => !x.ok);
  const summary = {
    ok: bad.length === 0,
    conftest: conf.version,
    total: rows.length,
    allow: rows.filter((x) => x.got === 'allow').length,
    deny: rows.filter((x) => x.got === 'deny').length,
    unknown: rows.filter((x) => x.got === 'unknown').length,
    mismatch: bad.length,
    rows,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`conftest ${conf.version} · policy/fixtures ${rows.length} 条`);
    for (const x of rows) {
      const mark = x.ok ? '✓' : '✗';
      const rules = x.rules && x.rules.length ? `  [${x.rules.join(',')}]` : '';
      console.log(`  ${mark} ${x.file}  期望 ${x.expect} · 实得 ${x.got}${rules}`);
    }
    console.log(
      bad.length === 0
        ? `\n全部符合预期：allow ${summary.allow} · deny ${summary.deny} · unknown ${summary.unknown}`
        : `\n${bad.length} 条判反了`,
    );
  }
  process.exit(bad.length === 0 ? 0 : 1);
}

main();

#!/usr/bin/env node
/**
 * verdict-determinism —— 批次不变性的机器门（L9 的可运行那一半）
 *
 * 用法：
 *   node scripts/verdict-determinism.mjs cases/coffee --adapter=memory
 *   node scripts/verdict-determinism.mjs cases/coffee --adapter=memory --out=.agent-web/determinism/baseline.json
 *   node scripts/verdict-determinism.mjs cases/coffee --adapter=memory --check=.agent-web/determinism/baseline.json
 *   node scripts/verdict-determinism.mjs cases/coffee --adapter=memory --strict --repeat=3
 *
 * 两个层次，别混：
 *   --repeat=N   同一次进程里跑 N 遍，比第 1 遍与第 N 遍  → 抓进程内的状态泄漏
 *   --check=F    与另一次进程留下的基线比               → 这才是 --jobs=1 vs --jobs=N 的门
 *
 * 退出码：0 指纹逐字一致；1 有漂移；2 用法或环境错误。
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadAdapter } from '../src/adapter/load.mjs';
import { judge } from '../src/runner.mjs';
import {
  fingerprintAll,
  diffFingerprints,
  formatDeterminismReport,
  manifestOf,
} from '../src/determinism.mjs';

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v === undefined ? true : v;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

function collectCaseFiles(target) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`路径不存在：${abs}`);
  if (fs.statSync(abs).isFile()) return [abs];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.json') && f !== 'expected.json' && f !== 'manifest.json')
    .sort()
    .map((f) => path.join(abs, f));
}

async function runOnce(files, adapter, adapterName) {
  const verdicts = [];
  for (const f of files) {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    verdicts.push(await judge({ case: c, adapter, adapterName }));
  }
  return verdicts;
}

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  if (args.length === 0) {
    console.error('用法：node scripts/verdict-determinism.mjs <目录或文件> [--adapter=NAME] [--repeat=N] [--strict] [--out=FILE] [--check=FILE] [--json]');
    return 2;
  }

  const adapterName = typeof flags.adapter === 'string' ? flags.adapter : 'memory';
  const repeat = flags.repeat !== undefined ? Number(flags.repeat) : 2;
  const strict = flags.strict === true;
  if (!Number.isInteger(repeat) || repeat < 1) {
    console.error('--repeat 必须是正整数');
    return 2;
  }

  let adapter;
  try {
    adapter = await loadAdapter(adapterName, {}, process.cwd());
  } catch (e) {
    console.error('加载适配器失败：' + (e && e.message));
    return 2;
  }

  const files = collectCaseFiles(args[0]);
  if (files.length === 0) {
    console.error('这个目录里没有案例');
    return 2;
  }

  // 第 1 遍当作基准，后面每一遍都与它比：进程内的漂移不该等到下一次跑批才发现。
  const first = fingerprintAll(await runOnce(files, adapter, adapterName), { strict });
  let drift = [];

  for (let i = 1; i < repeat; i += 1) {
    const again = fingerprintAll(await runOnce(files, adapter, adapterName), { strict });
    drift = drift.concat(diffFingerprints(first, again).map((d) => ({ ...d, run: i + 1 })));
  }

  let baselineDrift = [];
  if (typeof flags.check === 'string') {
    const p = path.resolve(flags.check);
    if (!fs.existsSync(p)) {
      console.error('基线文件不存在：' + p);
      return 2;
    }
    const baseline = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(baseline.fingerprints)) {
      console.error('基线文件不是 determinism 清单：' + p);
      return 2;
    }
    baselineDrift = diffFingerprints(baseline.fingerprints, first).map((d) => ({ ...d, run: 'baseline' }));
  }

  if (typeof flags.out === 'string') {
    const p = path.resolve(flags.out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      JSON.stringify(
        manifestOf(first, {
          adapter: adapterName,
          source: path.relative(process.cwd(), path.resolve(args[0])),
          strict,
        }),
        null,
        2,
      ) + '\n',
      'utf8',
    );
  }

  const all = [...drift, ...baselineDrift];
  if (flags.json) {
    console.log(JSON.stringify({ cases: first.length, strict, repeat, drift: all }, null, 2));
  } else {
    if (drift.length > 0) {
      console.log(`进程内重复 ${repeat} 遍：`);
      console.log(formatDeterminismReport(drift, { cases: first.length, strict }));
      console.log('');
    }
    if (baselineDrift.length > 0) {
      console.log('与基线比对：');
      console.log(formatDeterminismReport(baselineDrift, { cases: first.length, strict }));
      console.log('');
    }
    if (all.length === 0) {
      console.log(formatDeterminismReport([], { cases: first.length, strict }));
      if (repeat > 1) console.log(`（进程内跑了 ${repeat} 遍，逐字相同。）`);
      if (typeof flags.out === 'string') {
        console.log('基线写到 ' + path.relative(process.cwd(), path.resolve(flags.out)));
      }
    } else {
      console.log('判决漂移 = 这扇门不通过。先修确定性，再谈并发。');
    }
  }
  return all.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(2);
});

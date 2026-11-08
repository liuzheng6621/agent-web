#!/usr/bin/env node
/**
 * agent-web CLI
 *
 *   agent-web selftest                 零依赖自测：内置适配器 + 内置案例
 *   agent-web verify <目录或文件>       对指定适配器跑案例，出判决
 *   agent-web report <results.jsonl>   由判决结果出指标
 *  agent-web accept <文件> --by=NAME     确认草稿，确认后才能判决
 *  agent-web audit <可信.jsonl> <被审.jsonl>  用真实判决当尺子，量假绿/假红
 *  agent-web traps <结果.jsonl> --cases=目录  陷阱普查：这批判决有多少条在盲区里
 *  agent-web certify <案例目录> --adapter=SPEC  判据准入：哪些断言真的抓得住东西
 *  agent-web mutants                          变异体目录：实现能坏成什么样
 *   agent-web capabilities             打印适配器的能力清单与证据等级
 *   agent-web prepare <动作日志>       一次生成轨迹、案例草稿与流程预览
 *   agent-web draft <轨迹文件>          回放一条轨迹，反推案例草稿
 *   agent-web flow <案例或目录>           生成单个流程图或判决总览 HTML
 *   agent-web crosscheck --adapter=SPEC       交叉复核：不经过适配器自己的 fetch 再发一遍，比对响应
 *   agent-web discover <网址>                 输入一个网址：探测接口、生成适配器与案例
 *   agent-web init <目录>              生成一份案例模板
 *
 *   agent-web --version              打印版本（唯一来源：package.json）
 *
 * 退出码：0 全部符合预期；1 存在不符；2 用法或环境错误。
 */

import fs from 'node:fs';
import { writeImport, formatImport, HURL_VERSION } from '../src/import-hurl.mjs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { judge } from '../src/runner.mjs';
import { fingerprint } from '../src/values.mjs';
import { recordTrajectory } from '../src/record.mjs';
import { replayTrajectory, buildDraftCase } from '../src/draft.mjs';
import { validateCase, validateSteps, acceptCase, draftBlocker } from '../src/case.mjs';
import { renderFlowHtml, renderDashboardHtml } from '../src/flow.mjs';
import { summarize, agreement, formatText, countFailedAssertions } from '../src/report.mjs';
import { countTrajectory, formatCounts, COUNT_KEYS } from '../src/counts.mjs';
import { loadAdapter, listBuiltins } from '../src/adapter/load.mjs';
import { validateManifest } from '../src/adapter/contract.mjs';
import { ENTRIES, KNOWLEDGE_VERSION, validateAll } from '../knowledge/index.mjs';
import { signalsFromCertify, signalsFromProbe, recallSignals, loadState, saveState, bump, recallExit, formatRecall } from '../src/recall.mjs';
import { diffViews } from '../src/view.mjs';
import { auditRuns, formatAudit } from '../src/audit.mjs';
import { summarizeTraps, formatTraps, trapVerdict } from '../src/traps.mjs';
import { certify, formatCertify, formatSuggestions, certifyExit } from '../src/certify.mjs';
import { breedMutants, formatBreed, loadBredMutants, BREED_VERSION } from '../src/breed.mjs';
import { MUTATIONS, describeMutations } from '../src/mutate.mjs';
import { KINDS } from '../src/assert/index.mjs';
import { buildDrills, gradeDrills, writeDrills, readDrills, readSubmissions, formatGrade, gradeExit } from '../src/drill.mjs';
import { appendLedger, computeStats, formatStats, rankItems, readLedger, statsExit, toRecord } from '../src/drill-ledger.mjs';
import { alignExit, alignViews, formatAlign, renderAlignYaml } from '../src/align.mjs';
import { collectUsage, summarizeCoverage, formatCoverage, coverageVerdict } from '../src/coverage.mjs';
import { probeAdapter, formatProbe, probeExit } from '../src/probe.mjs';
import { discover, formatDiscover } from '../src/discover.mjs';
import { startTap } from '../src/tap.mjs';
import { readTraffic, learnTraffic, writeLearnOut } from '../src/learn.mjs';
import { deriveNegatives, renderNegativeSheet, formatNegativeSummary, writeNegatives, classifyObserved, formatObservedSummary } from '../src/negatives.mjs';
import { preflightAll, formatPreflight, preflightExit } from '../src/preflight.mjs';
import { crosscheck } from '../src/crosscheck.mjs';
import { formatCrosscheck } from '../src/assert/crosscheck.mjs';
import { ingestReport, formatIngest, ingestExit } from '../src/ingest.mjs';
import { collectVersionInfo } from '../src/version-info.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// 版本只有一处真相：package.json。CLI、CHANGELOG、测试都对着它看齐。
// 曾经出现过 package.json 0.16、README 0.9、Release v0.6.0 三个数各说各话。
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PACKAGE.version;
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out.flags[k] = v === undefined ? true : v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function collectCaseFiles(target) {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) throw new Error(`路径不存在：${abs}`);
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.json') && f !== 'expected.json' && f !== 'manifest.json')
    .sort()
    .map((f) => path.join(abs, f));
}

function readExpected(dirOrFile) {
  const abs = path.resolve(dirOrFile);
  const dir = fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  const p = path.join(dir, 'expected.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// manifest 校验必须发生在**读案例之前**。
// 现在它发生在 judge() 里：先读完案例、跑完复位、读完初态，才在判决里报
// invalid_environment。读者看到这个码会以为环境坏了，其实是声明写错了 ——
// 一个错字被包装成一次环境事故，浪费的不只是时间，是可信度。
// 所以 verify / certify / compare 在碰案例文件之前先问一次，坏了直接退 2。
async function precheckManifest(spec) {
  let adapter;
  try {
    adapter = await makeAdapter(spec);
  } catch (e) {
    return { ok: false, lines: [`加载适配器 ${spec} 失败：${e && e.message}`] };
  }
  let manifest;
  try {
    manifest = await adapter.manifest();
  } catch (e) {
    return { ok: false, lines: [`${spec} 的 manifest() 抛错：${e && e.message}`] };
  }
  const errors = validateManifest(manifest);
  if (errors.length === 0) return { ok: true, manifest };
  return {
    ok: false,
    lines: [
      `${spec} 的 manifest 没通过校验，共 ${errors.length} 条：`,
      ...errors.map((x, i) => `  ${i + 1}. ${x}`),
      '',
      '这不是环境坏了，是声明写错了。改完再跑 —— 现在退 2，是因为',
      '带着一份坏 manifest 跑出来的判决，读者会把它当成环境事故。',
    ],
  };
}

async function makeAdapter(name) {
  // 内置名 / 文件路径 / 包名都走同一个加载器：
  // 接自己的应用只需要写一个 .mjs，不必改本仓库的任何一行。
  return loadAdapter(name, {}, process.cwd());
}

function numFlag(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 候选轨迹按案例文件名同名查找：cases/x/happy-path.json ← trajectories/happy-path.json
function loadTrajectory(dir, caseFile) {
  if (typeof dir !== 'string' || dir === '') return null;
  const p = path.join(path.resolve(dir), path.basename(caseFile));
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw?.trajectory) ? raw.trajectory : null;
}

async function runOne(caseFile, adapter, opts = {}) {
  const raw = fs.readFileSync(caseFile, 'utf8');
  let c;
  try {
    c = JSON.parse(raw);
  } catch (e) {
    return {
      case_id: path.basename(caseFile, '.json'),
      adapter: 'n/a',
      status: 'unknown',
      reason_code: 'invalid_case',
      detail: `JSON 解析失败：${e.message}`,
      timing_ms: 0,
    };
  }
  return judge({
    case: c,
    adapter,
    adapterName: opts.adapterName,
    trajectory: opts.trajectory ?? null,
    timeoutMs: opts.timeoutMs ?? 0,
  });
}

async function cmdSelftest(flags) {
  const dir = path.join(ROOT, 'cases', 'coffee');
  const expected = readExpected(dir);
  // --adapter 曾经被无视：selftest 一律用内存适配器跑。
  // 结果是「真实后端 7/7 一致」这类结论其实从来没在真实后端上跑过 ——
  // 一个报告出来的数字，必须真的量到它说的那个东西。
  const adapterName = flags.adapter ? String(flags.adapter) : 'memory';
  const adapter = await makeAdapter(adapterName);
  announceCandidateMode(flags);
  const files = collectCaseFiles(dir);
  const verdicts = [];
  const selfOpts = { adapterName, timeoutMs: numFlag(flags.timeout) };
  for (const f of files) {
    verdicts.push(await runOne(f, adapter, { ...selfOpts, trajectory: loadTrajectory(flags.trajectory, f) }));
  }

  const summary = summarize(verdicts);
  const agree = agreement(verdicts, expected);

  if (flags.json) {
    console.log(JSON.stringify({ summary, agreement: agree, verdicts }, null, 2));
  } else {
    for (const v of verdicts) {
      const exp = expected[v.case_id];
      const mark = exp === undefined ? '·' : exp === v.status ? '✓' : '✗';
      console.log(`${mark} ${v.status.padEnd(7)} ${v.case_id.padEnd(32)} ${v.reason_code}`);
      if (v.status !== 'pass') console.log(`  └ ${v.detail}`);
    }
    console.log('');
    console.log(formatText(summary, { agreement: agree }));
    const fails = countFailedAssertions(verdicts);
    if (Object.keys(fails).length > 0) {
      console.log('');
      console.log('失败断言分布：');
      for (const [k, n] of Object.entries(fails).sort()) console.log(`  ${k.padEnd(34)} ${n}`);
    }
  }

  const mismatched = verdicts.filter((v) => expected[v.case_id] !== undefined && expected[v.case_id] !== v.status);
  return mismatched.length === 0 ? 0 : 1;
}

function readJsonl(file) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`路径不存在：${abs}`);
  return fs
    .readFileSync(abs, 'utf8')
    .split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${path.basename(abs)} 第 ${i + 1} 行不是合法 JSON：${e.message}`);
      }
    });
}

async function cmdAudit(args, flags) {
  if (args.length < 2) {
    console.error('用法：agent-web audit <可信结果.jsonl> <被审结果.jsonl> [--json] [--detail]');
    console.error('  可信的那份通常是真实后端跑出来的判决；被审的那份是新实现或改动后的实现。');
    return 2;
  }
  const report = auditRuns(readJsonl(args[0]), readJsonl(args[1]));
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatAudit(report, { detail: Boolean(flags.detail) }));
  }
  return report.sound ? 0 : 1;
}

function loadCaseDir(dir) {
  const out = new Map();
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'expected.json');
  } catch (e) {
    throw new Error(`读不了案例目录 ${dir}：${e && e.message}`);
  }
  for (const n of names) {
    const c = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    if (c && c.id) out.set(c.id, c);
  }
  return out;
}

// 案例目录 → [{file, case}]，file 相对仓库根，题目里要记住它才能批改时重跑。
function loadCaseEntries(dir) {
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'expected.json').sort();
  } catch (e) {
    throw new Error('读不了案例目录 ' + dir + '：' + (e && e.message));
  }
  for (const n of names) {
    const abs = path.join(dir, n);
    const c = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (c && c.id) out.push({ file: path.relative(ROOT, abs).split(path.sep).join('/'), case: c });
  }
  return out;
}

function drillMutations(flags) {
  const wanted = typeof flags.mutations === 'string'
    ? new Set(flags.mutations.split(',').map((x) => x.trim()).filter(Boolean))
    : null;
  const used = wanted ? MUTATIONS.filter((m) => wanted.has(m.id)) : MUTATIONS;
  return { used, wanted };
}

async function cmdDrill(args, flags) {
  if (args[0] === 'grade') return await cmdDrillGrade(args.slice(1), flags);
  if (args[0] === 'stats') return await cmdDrillStats(args.slice(1), flags);

  if (args.length < 1) {
    console.error('用法：agent-web drill <案例目录> [--adapter=memory] [--mutations=id,id] [--out=DIR] [--json]');
    console.error('      agent-web drill grade <题目目录> --submissions=DIR [--min=0.8] [--detail] [--json]');
    console.error('      --allow-missed：答了就必须对，没答的照实报（默认要求答满）');
    console.error('      agent-web drill stats [--ledger=FILE] [--detail] [--json]');
    console.error('      --record[=FILE]：把这次批改记进台账（默认 .agent-web/drills.jsonl）');
    console.error('  出题：对"整套断言都没抓住"的案例出题，题面不含答案。');
    console.error('  批改：不看提交说了什么，只看它跑出来什么——在正确实现上为真、在坏实现上为假才算抓到。');
    return 2;
  }

  const spec = flags.adapter ?? 'memory';
  const { used, wanted } = drillMutations(flags);
  if (used.length === 0) {
    console.error('--mutations 没有匹配到任何变异体；可用的：' + MUTATIONS.map((m) => m.id).join(', '));
    return 2;
  }
  const entries = loadCaseEntries(args[0]);
  if (entries.length === 0) {
    console.error('没有在 ' + args[0] + ' 里找到案例');
    return 2;
  }

  const report = await buildDrills({
    entries,
    adapterFactory: async () => loadAdapter(spec, {}, process.cwd()),
    adapterName: spec,
    timeoutMs: flags.timeout ? Number(flags.timeout) : 5000,
    mutations: used,
  });

  if (flags.order === 'empirical') {
    const ledgerFile = flags.ledger ?? path.join(ROOT, '.agent-web', 'drills.jsonl');
    const led = await readLedger(ledgerFile);
    if (led.records.length > 0) {
      const rank = rankItems(computeStats(led.records));
      const before = report.items.map((i) => i.id);
      report.items.sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return before.indexOf(a.id) - before.indexOf(b.id);
      });
      const measured = report.items.filter((i) => rank.has(i.id)).length;
      if (!flags.json) {
        console.log('按经验难度排序：' + measured + ' 道有台账记录（难的在前），' +
          (report.items.length - measured) + ' 道没测过（排在后面）');
        console.log('');
      }
    } else if (!flags.json) {
      console.log('台账里还没有记录，本次按原顺序出题');
      console.log('');
    }
  }

  const outDir = path.resolve(flags.out ?? 'drills');
  const index = flags.json ? null : await writeDrills(outDir, report);

  if (flags.json) {
    console.log(JSON.stringify({ generated: report.generated, items: report.items.map((i) => i.id) }, null, 2));
    return 0;
  }
  const g = report.generated;
  console.log('出题 · ' + g.cases + ' 案例 × ' + g.mutants + ' 变异体 = ' + g.pairs + ' 对');
  console.log('  出题 ' + g.asked + ' 道（另外 ' + g.skipped + ' 对已被案例本身抓住，不算题）');
  console.log('  写进 ' + path.relative(process.cwd(), outDir) + '：每题 .task.md 是题面，.json 含答案');
  for (const row of index.items) console.log('    ' + row.id);
  if (g.asked === 0) {
    console.log('');
    console.log('  没有题可出——这套断言把所有变异体都抓住了。');
    console.log('  想加题，就加变异体（docs/mutants/），别稀释断言。');
  }
  return 0;
}

async function cmdDrillGrade(args, flags) {
  const tasksDir = flags.tasks ?? args[0];
  const subsDir = flags.submissions;
  if (!tasksDir || !subsDir) {
    console.error('用法：agent-web drill grade <题目目录> --submissions=DIR [--adapter=memory] [--min=0.8] [--detail] [--json]');
    console.error('      --allow-missed：答了就必须对，没答的照实报（默认要求答满）');
    return 2;
  }

  const { items } = await readDrills(path.resolve(tasksDir));
  if (items.length === 0) {
    console.error('题目目录里没有题：' + tasksDir);
    return 2;
  }
  const submissions = await readSubmissions(path.resolve(subsDir));
  const spec = flags.adapter ?? 'memory';

  const report = await gradeDrills({
    items,
    submissions,
    adapterName: spec,
    adapterFactory: async () => loadAdapter(spec, {}, process.cwd()),
    loadCase: async (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')),
    timeoutMs: flags.timeout ? Number(flags.timeout) : 5000,
  });

  if (flags.record !== undefined) {
    const ledgerFile = typeof flags.record === 'string' ? flags.record : path.join(ROOT, '.agent-web', 'drills.jsonl');
    const record = toRecord(report, { submission: flags.submission ?? null });
    await appendLedger(ledgerFile, record);
    if (!flags.json) {
      console.log('');
      console.log('已记账：' + path.relative(process.cwd(), ledgerFile) + ' · ' + record.rows.length + ' 条');
    }
  }

  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatGrade(report, { detail: flags.detail === true }));

  return gradeExit(report, {
    min: flags.min !== undefined ? Number(flags.min) : null,
    allowMissed: flags['allow-missed'] === true,
  });
}

async function cmdDrillStats(args, flags) {
  const ledgerFile = flags.ledger ?? path.join(ROOT, '.agent-web', 'drills.jsonl');
  const { records, bad_lines, missing } = await readLedger(ledgerFile);
  if (missing) {
    console.error('没有台账：' + ledgerFile);
    console.error('先跑一次带 --record 的批改，例如：');
    console.error('  agent-web drill grade drills/ --submissions=examples/drills/good --allow-missed --record');
    return 2;
  }
  const stats = computeStats(records, { includeUngraded: flags['include-ungraded'] === true });
  if (flags.json) console.log(JSON.stringify(stats, null, 2));
  else {
    console.log(formatStats(stats, { detail: flags.detail === true }));
    if (bad_lines > 0) {
      console.log('');
      console.log('提醒：台账里有 ' + bad_lines + ' 行读不懂（版本不符或损坏），已跳过，没算进统计。');
    }
  }
  return statsExit(stats, {
    minAttempts: flags['min-attempts'] !== undefined ? Number(flags['min-attempts']) : null,
  });
}


async function cmdAlign(args, flags) {
  if (args.length < 2) {
    console.error('用法：agent-web align <参照视图.json> <目标视图.json> [--out=align.yml] [--detail] [--json]');
    console.error('      --require-all：所有字段都必须配上，留下未定就算失败');
    console.error('      --max-unresolved=N：未定条目超过 N 就算失败');
    console.error('  输入是两份规范视图（{集合名: 行数组}）。输出是建议映射，低置信度一律进 unresolved，不猜。');
    return 2;
  }
  const read = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));
  const ref = read(args[0]);
  const target = read(args[1]);
  const report = alignViews(ref, target, { source: args[0], target: args[1] });
  if (flags.out) {
    fs.writeFileSync(path.resolve(flags.out), renderAlignYaml(report), 'utf8');
  }
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(formatAlign(report, { detail: flags.detail === true }));
    if (flags.out) {
      console.log('');
      console.log('写进 ' + path.relative(process.cwd(), path.resolve(flags.out)) + '（accepted 段是空的，人签之后才算生效）');
    }
  }
  return alignExit(report, {
    requireAll: flags['require-all'] === true,
    maxUnresolved: flags['max-unresolved'] !== undefined ? Number(flags['max-unresolved']) : null,
  });
}


async function cmdNegatives(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web negatives <目录或文件> [--adapter=memory] [--out=DIR] [--max=N] [--json] [--detail]');
    console.error('  从清单的**声明**派生负例候选（必填缺失 / 角色越权 / 类型不符 / 边界越界 / 不存在实体 / 重复提交）。');
    console.error('  全部标 disputed，只写审阅表，不写进案例目录，也不进判决。');
    console.error('  加 --run 会实际跑一遍，按结果分四类：observed_reject / observed_accept / diverged / unknown。');
    console.error('  --second=SPEC 时同一个候选在两个实现上都跑，结论不同记 diverged。');
    return 2;
  }
  const adapterName = flags.adapter ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const manifest = await adapter.manifest();
  const files = collectCaseFiles(args[0]);
  const max = flags.max !== undefined ? Number(flags.max) : 40;

  const results = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const errors = validateCase(raw);
    if (errors.length > 0) {
      console.error(`${path.relative(process.cwd(), f)} 不是合法案例，跳过：${errors[0]}`);
      continue;
    }
    results.push({
      case_id: raw.id,
      source: path.relative(process.cwd(), f),
      candidates: deriveNegatives({ case: raw, manifest, max }),
    });
  }

  // --run：把候选真的跑一遍。观察到的事实仍然不是判据 —— 每条候选保持 disputed，
  // 只是多了一栏「实际发生了什么」，让人判断洞在实现里还是在声明里。
  if (flags.run) {
    const second = flags.second ? await makeAdapter(String(flags.second)) : null;
    for (const r of results) {
      for (const cand of r.candidates) {
        const store = JSON.parse(fs.readFileSync(path.join(ROOT, r.source), 'utf8'));
        const mk = () => ({
          ...JSON.parse(JSON.stringify(store)),
          id: `${r.case_id}~${cand.kind}`,
          task: {
            ...JSON.parse(JSON.stringify(store.task)),
            goal_assertions: [
              {
                kind: 'entity_exists',
                selector: { collection: (store.task?.goal_assertions?.[0]?.selector?.collection) ?? 'orders' },
              },
            ],
            invariants: [],
          },
          reference_trajectory: cand.steps,
        });
        const base = mk();
        // 传整个判决而不是 .verdict：分类要看 evidence.trace 里最后一步的结局
        const va = await judge({ case: base, adapter, adapterName: adapterName });
        const vb = second ? await judge({ case: base, adapter: second, adapterName: String(flags.second) }) : null;
        cand.observed = classifyObserved(va, vb, cand.expectation);
      }
    }
  }

  const outDir = flags.out ?? path.join('.agent-web', 'negatives');
  const written = writeNegatives(outDir, results);

  if (flags.json) {
    console.log(JSON.stringify({ dir: written.dir, results }, null, 2));
  } else {
    console.log(formatNegativeSummary(results));
    if (flags.run) {
      console.log('');
      console.log(formatObservedSummary(results));
    }
    if (flags.detail) {
      for (const r of results) {
        console.log('');
        console.log(renderNegativeSheet(r.case_id, r.candidates));
      }
    }
    console.log('');
    console.log(`审阅表写到 ${path.relative(process.cwd(), written.dir)}/（${written.files.length} 个文件）`);
    console.log('这些候选不进判决。确认之后改写成案例，再 agent-web accept 署名。');
  }
  return 0;
}


async function cmdPreflight(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web preflight <目录或文件> [--adapter=SPEC] [--detail] [--json]');
    console.error('  跑之前先对账：拿清单的声明预测每条案例会判成什么（ready / unknown / fail）。');
    console.error('  预测与 expected.json 对不上才判红；仓库里故意写坏的案例不算问题。');
    return 2;
  }
  const adapterName = flags.adapter ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const manifest = await adapter.manifest();
  const files = collectCaseFiles(args[0]);
  const expected = readExpected(args[0]);

  const cases = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const errors = validateCase(raw);
    if (errors.length > 0) {
      console.error(`${path.relative(process.cwd(), f)} 不是合法案例，跳过：${errors[0]}`);
      continue;
    }
    cases.push(raw);
  }

  const results = preflightAll({ cases, manifest, expected });
  if (flags.json) {
    console.log(JSON.stringify({ adapter: adapterName, results }, null, 2));
  } else {
    console.log(formatPreflight(results, { detail: flags.detail === true }));
  }
  return preflightExit(results);
}


function cmdMutants(args, flags) {
  const list = describeMutations();
  if (flags.json) {
    console.log(JSON.stringify(list, null, 2));
    return 0;
  }
  console.log(`变异体目录 · ${list.length} 个 · docs/mutants/`);
  console.log('');
  for (const m of list) {
    console.log(`${m.id}  [${m.layer}]`);
    console.log(`  ${m.title}`);
    console.log(`  症状：${m.symptom}`);
    console.log(`  怎么坏：${m.mechanism}`);
    console.log(`  怎么抓：${m.catch_hint}`);
    console.log('');
  }
  console.log('投稿：复制 docs/mutants/ 里任一文件，改 id 与 wrap，登记到 index.mjs 的 ENTRIES，跑 npm test。');
  return 0;
}

async function cmdImport(args, flags) {
  const what = args[0];
  const target = args[1];
  if (!what || !target) {
    console.error('用法：agent-web import hurl <文件或目录> --out=DIR [--as=角色] [--uid=] [--json]');
    console.error('');
    console.error('  hurl 是纯文本的接口测试格式，RealWorld 那类语料自带一整套。');
    console.error('  转换器只做能确定的事：请求 → 步、[Captures] → 捕获、[Asserts] → payload 断言；');
    console.error('  读不懂的写进同名 .todo.md，不猜。');
    return 2;
  }
  if (what !== 'hurl') {
    console.error('只认 hurl：目前没有 hurl 之外的转换器。');
    return 2;
  }
  if (!fs.existsSync(target)) {
    console.error('找不到 ' + target);
    return 2;
  }
  const out = String(flags.out || 'cases/imported');
  const made = writeImport(target, out, {
    as: flags.as ? String(flags.as) : 'user',
    uid: flags.uid ? String(flags.uid) : '000000',
  });
  if (flags.json) {
    console.log(JSON.stringify({ version: HURL_VERSION, out, suites: made }, null, 2));
    return 0;
  }
  console.log(formatImport(made));
  console.log('');
  console.log('写到 ' + out + '，都是未确认草稿。');
  return 0;
}

function cmdVersion(flags) {
  if (flags.json) {
    console.log(JSON.stringify({ name: PACKAGE.name, version: VERSION, node: process.versions.node }));
  } else {
    console.log(`${PACKAGE.name} ${VERSION}`);
  }
  return 0;
}

// 「agent-web version」子命令：HELP 与 README 命令表承诺
// 「版本、最近一次变更、以及版本号三处是否一致」。此前实现只打印一行
// 版本号，承诺落空——用户照文档跑这条命令定版本时，拿到的是一句没有判决的话。
function cmdVersionReport(flags) {
  const info = collectVersionInfo({ root: ROOT, pkgVersion: VERSION });
  const places = [
    `package.json ${info.pkgVersion}`,
    `VERSION ${info.versionFile ?? '（不存在）'}`,
    `CHANGELOG ${info.changelogVersion ?? '（无首条版本）'}`,
  ];
  if (flags.json) {
    console.log(JSON.stringify({
      name: PACKAGE.name,
      version: VERSION,
      node: process.versions.node,
      versionFile: info.versionFile,
      changelogVersion: info.changelogVersion,
      changelogHead: info.changelogHead,
      latestSummary: info.latestSummary,
      consistent: info.consistent,
      problems: info.problems,
    }));
    return info.consistent ? 0 : 1;
  }
  console.log(`${PACKAGE.name} ${VERSION}`);
  console.log(`最近一次变更  ${info.changelogHead ?? '（CHANGELOG 没有「## x.y.z」首条）'}`);
  if (info.latestSummary) console.log(`  ${info.latestSummary}`);
  console.log(`版本号三处  ${places.join(' · ')} → ${info.consistent ? '一致' : '不一致'}`);
  for (const p of info.problems) console.log(`  - ${p}`);
  return info.consistent ? 0 : 1;
}

async function cmdKnowledge(flags) {
  const check = validateAll();
  if (flags.json) {
    console.log(JSON.stringify({ version: KNOWLEDGE_VERSION, ok: check.ok, problems: check.problems, entries: ENTRIES }, null, 2));
    return check.ok ? 0 : 1;
  }
  console.log(`事故档案 ${KNOWLEDGE_VERSION} · ${ENTRIES.length} 条`);
  for (const e of ENTRIES) {
    console.log("");
    console.log(`  ${e.id}  ${e.title}`);
    console.log(`    症状：${e.symptom}`);
    console.log(`    判据：${e.guard.kind} ${e.guard.ref}`);
    console.log(`    复现：${e.repro}`);
  }
  if (!check.ok) {
    console.error("");
    console.error("档案自身不合法：");
    for (const p of check.problems) console.error(`  ${p}`);
    return 1;
  }
  return 0;
}

async function cmdRecall(args, flags) {
  const dir = args[0] ?? "cases/coffee";
  const spec = flags.adapter ?? "memory";
  const map = loadCaseDir(dir);
  const cases = [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (cases.length === 0) {
    console.error(`没有在 ${dir} 里找到案例`);
    return 2;
  }
  const timeoutMs = flags.timeout ? Number(flags.timeout) : 5000;
  const signals = [];
  if (flags["skip-certify"] !== true) {
    const report = await certify({
      cases,
      adapterFactory: async () => loadAdapter(spec, {}, process.cwd()),
      adapterName: spec,
      timeoutMs,
      mutations: MUTATIONS,
    });
    signals.push(...signalsFromCertify(report));
  }
  if (flags["skip-probe"] !== true) {
    const pr = await probeAdapter({ adapter: await loadAdapter(spec, {}, process.cwd()), adapterName: spec, timeoutMs });
    signals.push(...signalsFromProbe(pr));
  }
  const result = recallSignals(signals, { loose: flags.loose === true });
  const state = loadState(process.cwd());
  const rows = bump(state, result.matchedIds);
  if (flags["dry-run"] !== true) saveState(process.cwd(), state);
  if (flags.json) {
    console.log(JSON.stringify({ signals, result, rows }, null, 2));
  } else {
    console.log(formatRecall(result, { rows, root: process.cwd() }));
  }
  return recallExit(rows, { noGate: flags["no-gate"] === true });
}

async function cmdProbe(flags) {
  const spec = flags.adapter ?? "memory";
  const adapter = await loadAdapter(spec, {}, process.cwd());
  const result = await probeAdapter({
    adapter,
    adapterName: spec,
    timeoutMs: flags.timeout ? Number(flags.timeout) : 5000,
    allowVolatile: flags["allow-volatile"] === true,
  });
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatProbe(result, { detail: flags.detail === true }));
  return probeExit(result);
}
async function cmdTap(args, flags) {
  const target = flags.target || args[0];
  if (!target) {
    console.error('用法：agent-web tap --target=URL [--port=8080] [--out=DIR] [--seconds=N]');
    return 2;
  }
  const port = Number(flags.port || 8080);
  const out = flags.out || './tap-out';
  const seconds = Number(flags.seconds || 0);
  process.stderr.write(
    `tap：把流量转发到 ${target}
` +
      `      监听 http://127.0.0.1:${port}，录到 ${out}/traffic.jsonl
` +
      `      红线：流量会真的打到目标；对生产库录写操作是你自己的选择。
` +
      `      鉴权头与 cookie 原值不落盘（落假名）。Ctrl-C 结束录制（或 --seconds=N）。
`,
  );
  const tap = startTap({ target, port, out });
  if (seconds > 0) {
    await new Promise((r) => setTimeout(r, seconds * 1000));
  } else {
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  }
  const info = await tap.stop();
  console.log(`录制结束：${info.lines} 条请求 -> ${info.file}`);
  console.log(`下一步：agent-web learn ${info.file} --out=${out}/learned`);
  return 0;
}

function cmdLearn(args, flags) {
  const file = args[0];
  if (!file) {
    console.error('用法：agent-web learn <traffic.jsonl> [--out=DIR] [--name=名字] [--env=变量名] [--accept=名字]');
    return 2;
  }
  const out = flags.out || './learned';
  const records = readTraffic(file);
  if (records.length === 0) {
    console.error(`${file} 里一条请求都没解析出来`);
    return 1;
  }
  const learned = learnTraffic(records, { name: flags.name });
  const written = writeLearnOut(out, learned, { name: flags.name, env: flags.env, accept: flags.accept });
  console.log(
    `learn：${records.length} 条请求 -> ${Object.keys(written.spec.capabilities).length} 个能力 / ` +
      `${Object.keys(written.spec.view).length} 个视图集合 / ${written.twin.steps.length} 步可回放写操作`,
  );
  console.log(`  认不出 ${learned.unclassified.length} 条（见 unclassified.jsonl；认不出不猜）`);
  for (const f of written.files) console.log(`  写了 ${path.join(out, f)}`);
  console.log('接下来：');
  console.log('  1 改 adapter.yml 里不对的行（观察推断的都标 inferred）');
  console.log(`  2 agent-web verify ${path.join(out, 'cases')} --adapter=${path.join(out, 'adapter.yml')}`);
  console.log(`  3 agent-web verify ${path.join(out, 'cases')} --adapter=${path.join(out, 'twin.json')}   # 孪生对照`);
  if (!flags.accept) console.log('  案例默认是草稿：agent-web accept <id> --by=<名字> 之后才出判决');
  return 0;
}

async function cmdIngest(args, flags) {
  const file = args[0];
  if (!file) {
    console.error('用法：agent-web ingest <外部报告.json> [--from=e2e] [--json]');
    console.error('      把别家的测试报告翻成 pass / fail / unknown，并数出「跑绿了但什么都没证明」的比例。');
    console.error('      只翻译判决词汇，不冒充「外部测试等于本仓库的案例」。');
    return 2;
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`读不了 ${file}：${e && e.message}`);
    return 2;
  }
  const report = ingestReport(doc, { from: flags.from });
  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatIngest(report));
  }
  return ingestExit(report);
}

async function cmdCrosscheck(args, flags) {
  const spec = flags.adapter ?? null;
  if (!spec) {
    console.error('用法：agent-web crosscheck --adapter=SPEC [--base=URL] [--timeout=8000] [--json]');
    console.error('  走 HTTP 的适配器：用不经过适配器自己的 fetch 的通道再发一遍同样的请求，比对响应。');
    console.error('  三类结论：consistent / divergent / uncheckable。');
    console.error('  uncheckable 不算通过——把「查不了」记成「没问题」是这类工具最容易犯的错。');
    console.error('  退出码：有 divergent → 1；全部一致 → 0；其余（含全部查不了）→ 2。');
    return 2;
  }
  const adapter = await loadAdapter(spec, {}, process.cwd());
  const report = await crosscheck({
    adapter,
    adapterName: spec,
    baseUrl: flags.base ? String(flags.base) : undefined,
    timeoutMs: flags.timeout ? Number(flags.timeout) : 8000,
  });
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else if (report.reason) {
    console.log('交叉复核 · 适配器 ' + report.adapter + ' · 一条都没复核');
    console.log('');
    console.log('  ' + report.reason);
  } else console.log(formatCrosscheck(report));
  return report.exitCode;
}

async function cmdDiscover(args, flags) {
  if (args.length < 1) {
    console.error("用法：agent-web discover <网址> [--out=目录] [--run] [--writes] [--detail] [--accept=名字] [--timeout=8000] [--json]");
    console.error("  输入一个网址，探测它有哪些接口，生成一个能跑的只读适配器与一批只读案例。");
    console.error("  它不会猜写操作该保证什么 —— 那需要业务知识，猜出来的判决没有意义。");
  console.error("  --writes：给 create 类接口生成往返案例（只断「写完多了一条」，不断内容对不对）。");
    return 2;
  }
  const report = await discover(args[0], {
    outDir: flags.out ?? "./agent-web-site",
    run: flags.run === true,
    accept: typeof flags.accept === "string" ? flags.accept : null,
    timeoutMs: flags.timeout ? Number(flags.timeout) : 8000,
    writes: flags.writes === true,
  });
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatDiscover(report, { detail: flags.detail === true }));
  if (!report.reachable) return 2;
  if (report.source !== "openapi") return 1;
  const bad = report.reads.filter((r) => !r.ok);
  return bad.length > 0 ? 1 : 0;
}

/** 同名的 flag 给多次时收成数组；只给一次时也收成数组，调用方不用分情况。 */
function toList(v) {
  if (v === undefined || v === null || v === false) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

async function cmdCertify(args, flags) {
  if (args.length < 1) {
    console.error('用法：agent-web certify <案例目录> [--adapter=memory] [--mutations=id,id] [--mutants-dir=目录] [--timeout=5000] [--strict] [--detail] [--suggest] [--json]');
    console.error('  --mutants-dir 额外加载 breed 生成的变异体（可重复给多个）。');
    console.error('  它把正确实现复制成若干个"只坏一处"的变异体，逐条断言问：你能把它抓出来吗？');
    console.error('  抓不住任何变异体的断言，就是该被拒收的断言。');
  console.error('  --suggest 会把「已经被证明杀得掉、只是还没写出来」的断言直接吐出来。');
    console.error(`  内置变异体：${describeMutations().map((m) => m.id).join(', ')}`);
    return 2;
  }
  const spec = flags.adapter ?? 'memory';
  const bred = [];
  for (const dir of toList(flags['mutants-dir'] ?? flags.mutantsDir)) {
    bred.push(...(await loadBredMutants(path.resolve(dir))));
  }
  const pool = bred.length > 0 ? [...MUTATIONS, ...bred] : MUTATIONS;
  const wanted = typeof flags.mutations === 'string' ? new Set(flags.mutations.split(',').map((x) => x.trim()).filter(Boolean)) : null;
  const used = wanted ? pool.filter((m) => wanted.has(m.id)) : pool;
  if (used.length === 0) {
    console.error(`--mutations 没有匹配到任何变异体；内置：${MUTATIONS.map((m) => m.id).join(', ')}`);
    return 2;
  }

  const pre = await precheckManifest(spec);
  if (!pre.ok) {
    for (const line of pre.lines) console.error(line);
    return 2;
  }

  const map = loadCaseDir(args[0]);
  const cases = [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (cases.length === 0) {
    console.error(`没有在 ${args[0]} 里找到案例`);
    return 2;
  }
  const report = await certify({
    cases,
    adapterFactory: async () => loadAdapter(spec, {}, process.cwd()),
    adapterName: spec,
    timeoutMs: flags.timeout ? Number(flags.timeout) : 5000,
    mutations: used,
  });
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else if (flags.suggest === true) console.log(formatSuggestions(report));
  else console.log(formatCertify(report, { detail: flags.detail === true }));
  return certifyExit(report, { strict: flags.strict === true });
}

async function cmdBreed(args, flags) {
  const out = flags.out;
  if (!out) {
    console.error('用法：agent-web breed --adapter=memory --out=目录 [--from-case=案例.json] [--max=24] [--detail] [--json]');
    console.error('  从适配器观测到的规范视图形状，自动生成变异体。');
    console.error('  --from-case 先跑一条案例再观测（不给的话只看得到静态表，看不到订单这类做出来的数据）。');
    console.error('  --collections 限定在哪些集合里造故障，默认 orders,menu。status_log 是内部流水，');
    console.error('  生成不等于入库：能不能留下由 certify 判，杀不掉任何断言的一律落 undetermined。');
    return 2;
  }
  const spec = flags.adapter ?? 'memory';
  const adapter = await loadAdapter(spec, {}, process.cwd());
  let caseObj = null;
  if (flags['from-case'] ?? flags.fromCase) {
    const file = path.resolve(String(flags['from-case'] ?? flags.fromCase));
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const errors = validateCase(parsed);
    if (errors.length) {
      console.error('案例不合法：' + errors.join('；'));
      return 2;
    }
    caseObj = parsed;
  }
  const report = await breedMutants({
    adapter,
    adapterName: spec,
    out: path.resolve(out),
    max: flags.max ? Number(flags.max) : 24,
    collections: (flags.collections ?? 'orders,menu').split(',').map((x) => x.trim()).filter(Boolean),
    caseObj,
  });
  if (flags.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatBreed(report, { detail: flags.detail === true }));
  return report.written > 0 ? 0 : 1;
}

async function cmdTraps(args, flags) {
  if (args.length < 1) {
    console.error('用法：agent-web traps <结果.jsonl> --cases=目录 [--max-blind=0] [--detail] [--json]');
    console.error('  它对每条判决问一句：这条判决是在盲区里产生的吗？');
    console.error('  与 audit 的分工：audit 要有两个实现对照，traps 只要一份判决加案例集。');
    return 2;
  }
  const casesDir = flags.cases;
  if (!casesDir) {
    console.error('缺 --cases=目录：没有案例原文，就不知道每条判决当时面对的是什么任务。');
    return 2;
  }

  const cases = loadCaseDir(casesDir);
  const verdicts = readJsonl(args[0]);
  const pairs = [];
  const unmatched = [];
  for (const v of verdicts) {
    const c = cases.get(v.case_id);
    if (!c) {
      unmatched.push(v.case_id);
      continue;
    }
    pairs.push({ verdict: v, case: c });
  }

  const report = summarizeTraps(pairs);
  // 默认只报告不拦截：盲区率是结构性的（「只看终态」这类缺陷常常整批都是），
  // 给一个默认门槛会让 CI 永远红，从而被 --max-blind 一个参数关掉、再没人看。
  // 要设门槛就显式给。
  const gated = flags['max-blind'] !== undefined;
  const verdict = gated
    ? trapVerdict(report, { maxBlind: Number(flags['max-blind']) })
    : { ok: true, reason: '只报告，未设门槛（要拦截请给 --max-blind=0.2）' };

  if (flags.json) {
    console.log(JSON.stringify({ ...report, matched: pairs.length, unmatched, judgement: verdict }, null, 2));
  } else {
    console.log(formatTraps(report, { detail: Boolean(flags.detail) }));
    if (unmatched.length > 0) {
      console.log('');
      console.log(`  没找到案例原文的判决：${unmatched.length} 条（${unmatched.slice(0, 5).join(', ')}）`);
    }
    console.log('');
    console.log(`  ${verdict.ok ? '通过' : '不通过'}：${verdict.reason}`);
  }
  return verdict.ok ? 0 : 1;
}

async function cmdAccept(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web accept <案例文件> --by=<确认人> [--at=ISO时间]');
    return 2;
  }
  const file = path.resolve(args[0]);
  let c;
  try {
    c = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`读取失败：${e && e.message}`);
    return 2;
  }
  let accepted;
  try {
    accepted = acceptCase(c, { by: flags.by, at: flags.at });
  } catch (e) {
    console.error(`无法确认：${e && e.message}`);
    return 2;
  }
  const errors = validateCase(accepted);
  if (errors.length > 0) {
    console.error('案例未通过格式校验，不予确认：');
    for (const err of errors) console.error(`  - ${err}`);
    return 1;
  }
  const was = draftBlocker(c);
  fs.writeFileSync(file, JSON.stringify(accepted, null, 2) + String.fromCharCode(10), 'utf8');
  const rel = path.relative(process.cwd(), file) || file;
  console.log(`已确认 ${rel}`);
  console.log(`  draft.status: ${was ? was.status : '无 draft 字段（本就可判决）'} → confirmed`);
  console.log(`  reviewed_by:  ${accepted.draft.reviewed_by}`);
  console.log(`  reviewed_at:  ${accepted.draft.reviewed_at}`);
  return 0;
}

async function cmdVerify(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web verify <目录或文件> [--adapter=memory]');
    return 2;
  }
  const adapterName = flags.adapter ?? 'memory';
  const pre = await precheckManifest(adapterName);
  if (!pre.ok) {
    for (const line of pre.lines) console.error(line);
    return 2;
  }
  const adapter = await makeAdapter(adapterName);
  const files = collectCaseFiles(args[0]);
  const expected = readExpected(args[0]);
  announceCandidateMode(flags);

  const verdicts = [];
  const verifyOpts = { adapterName, timeoutMs: numFlag(flags.timeout) };
  for (const f of files) {
    verdicts.push(await runOne(f, adapter, { ...verifyOpts, trajectory: loadTrajectory(flags.trajectory, f) }));
  }

  if (flags.json) {
    console.log(JSON.stringify(verdicts, null, 2));
  } else {
    for (const v of verdicts) {
      // 有 expected.json 就打 ✓/✗，没有就打 · —— 判决本身仍然照常输出。
      const exp = expected[v.case_id];
      const mark = exp === undefined ? '·' : exp === v.status ? '✓' : '✗';
      console.log(`${mark} ${v.status.padEnd(7)} ${v.case_id.padEnd(32)} ${v.reason_code}`);
      console.log(`  └ ${v.detail}`);
    }
    console.log('');
    console.log(formatText(summarize(verdicts), { agreement: agreement(verdicts, expected) }));
  }

  const out = flags.out;
  if (typeof out === 'string') {
    // 目录不存在时自己建：CI 上第一次跑 .tmp-ci/xxx.jsonl 就死在这里。
    // 本地因为目录早就在了，永远看不到——真踩过（GitHub CI 红了一整天）。
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), verdicts.map((v) => JSON.stringify(v)).join('\n') + '\n', 'utf8');
    console.error(`已写入 ${out}`);
  }

  // 退出码跟文档对齐：0 符合预期，1 存在不符。
  // 注意「有 fail」不等于「不符」——负例本来就该 fail，
  // 按 fail 判退出的写法会让任何带负例的案例集永远返回 1，CI 里直接卡死。
  const declared = Object.keys(expected);
  if (declared.length === 0) {
    // 没写 expected.json：没有预期可比，只能按「出现了 fail」提示有人来看。
    return verdicts.some((v) => v.status === 'fail') ? 1 : 0;
  }
  const mismatched = verdicts.filter((v) => expected[v.case_id] !== undefined && expected[v.case_id] !== v.status);
  const undeclared = verdicts.filter((v) => expected[v.case_id] === undefined);
  if (undeclared.length > 0) {
    console.error(`提示：${undeclared.length} 条案例没有在 expected.json 里声明预期，按不符处理`);
    return 1;
  }
  return mismatched.length === 0 ? 0 : 1;
}

async function cmdReport(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web report <results.jsonl> [--expected=<expected.json>] [--counts [--adapter=X] [--cases=DIR] [--json]]');
    return 2;
  }
  const lines = fs
    .readFileSync(path.resolve(args[0]), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  let verdicts;
  try {
    verdicts = lines.map((l) => JSON.parse(l));
  } catch (e) {
    // 最常见的误用：把案例文件当判决文件喂进来。指出来，别丢一句 JSON 解析错误。
    let looksLikeCase = false;
    try {
      looksLikeCase = Array.isArray(JSON.parse(fs.readFileSync(path.resolve(args[0]), 'utf8')).reference_trajectory);
    } catch { /* 也不是案例 */ }
    console.error(looksLikeCase
      ? `这份文件是案例（含 reference_trajectory），不是判决。先跑 agent-web verify ${args[0]} --out=results.jsonl，再 report 那份 jsonl。`
      : `读不了 ${args[0]}：${e.message}`);
    return 2;
  }
  const expected = typeof flags.expected === 'string' ? JSON.parse(fs.readFileSync(path.resolve(flags.expected), 'utf8')) : {};
  const summary = summarize(verdicts);

  // `--counts`：只数轨迹，不判。它跟下面的指标块是两回事，
  // 所以走单独的出口——混在一起早晚有人把计数当成分数读。
  if (flags.counts) {
    const reads = await readCapabilitySet(flags.adapter);
    const refs = typeof flags.cases === 'string' ? referenceStepCounts(flags.cases) : null;
    const rows = verdicts.map((v) => ({
      case_id: v.case_id,
      counts: countTrajectory(v.evidence?.trace ?? [], {
        reads,
        referenceSteps: refs ? refs.get(v.case_id) ?? null : null,
      }),
    }));
    if (flags.json) {
      console.log(JSON.stringify(rows.map((r) => ({ case_id: r.case_id, ...r.counts })), null, 2));
    } else {
      console.log(formatCounts(rows));
    }
    return 0;
  }

  if (flags.json) {
    console.log(JSON.stringify({ summary, agreement: agreement(verdicts, expected) }, null, 2));
  } else {
    console.log(formatText(summary, { agreement: Object.keys(expected).length ? agreement(verdicts, expected) : null }));
  }
  return 0;
}

/** 从案例目录读出每条案例的参考轨迹长度，作为绕路比的分母。 */
function referenceStepCounts(caseDir) {
  const map = new Map();
  for (const file of collectCaseFiles(caseDir)) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      // 案例文件里是 `id` 与顶层 `reference_trajectory`；判决里是 `case_id`。
      const id = c.case_id ?? c.id ?? path.basename(file, '.json');
      const n = (c.reference_trajectory ?? c.task?.reference_trajectory ?? []).length;
      if (n > 0) map.set(id, n);
    } catch { /* 读不了的案例不影响其余 */ }
  }
  return map;
}

/** 拿到适配器就按 manifest 的 kind 判读写；拿不到返回 null，由计数层退回后缀启发式。 */
async function readCapabilitySet(adapterName) {
  if (!adapterName) return null;
  try {
    const adapter = await makeAdapter(String(adapterName));
    const manifest = await adapter.manifest();
    const reads = (manifest.capabilities ?? []).filter((c) => c.kind === 'read').map((c) => c.id);
    if (typeof adapter.close === 'function') await adapter.close();
    return new Set(reads);
  } catch {
    return null;
  }
}

async function cmdCapabilities(args, flags) {
  const adapterName = flags.adapter ?? args[0] ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const m = await adapter.manifest();
  console.log(JSON.stringify(m, null, 2));
  return 0;
}

// 能力覆盖率：把 manifest 声明的能力和案例真正用到的能力对上账。
// 它不跑案例、不下判决，只回答「这套案例碰过这个系统的多少面」。
async function cmdCoverage(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web coverage <目录或文件> [--adapter=memory] [--min=0.8] [--detail] [--json]');
    return 2;
  }
  const adapterName = flags.adapter ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const manifest = await adapter.manifest();

  const files = collectCaseFiles(args[0]);
  const cases = [];
  const skipped = [];
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    const errors = validateCase(raw);
    if (errors.length > 0) {
      skipped.push({ file: path.basename(f), error: errors[0] });
      continue;
    }
    cases.push(raw);
  }

  const report = summarizeCoverage(collectUsage(cases, manifest));
  const min = flags.min !== undefined && flags.min !== true ? Number(flags.min) : null;
  const verdict = coverageVerdict(report, { min });

  if (flags.json) {
    const payload = { ...report };
    if (flags.detail) {
      payload.unused = report.unused_list;
      payload.missing_capabilities = report.missing_list;
      payload.missing_scopes = report.scope_missing_list;
    }
    payload.verdict = verdict;
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(formatCoverage(report, { detail: Boolean(flags.detail) }));
  }

  if (skipped.length > 0) {
    console.error('');
    console.error(`注意：${skipped.length} 个文件没通过校验，未计入覆盖率`);
    for (const s of skipped) console.error(`  ${s.file}: ${s.error}`);
  }

  if (!verdict.ok) {
    console.error('');
    console.error(`不通过：${verdict.why}`);
    return 1;
  }
  return 0;
}


function cmdInit(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web init <目录> [--adapter=memory]');
    return 2;
  }
  const dir = path.resolve(args[0]);
  const adapterName = typeof flags.adapter === 'string' ? flags.adapter : 'memory';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'example.json');
  if (fs.existsSync(file)) {
    console.error(`已存在：${file}`);
    return 2;
  }
  const tpl = structuredClone(TEMPLATE);
  tpl.environment.adapter = adapterName;
  fs.writeFileSync(file, JSON.stringify(tpl, null, 2) + '\n', 'utf8');
  console.log(`已生成 ${file}`);
  console.log('下一步：');
  console.log('  1. 把 capabilities / 断言改成你的系统真实具备的东西');
  console.log(`  2. agent-web verify ${args[0]} --adapter=${adapterName}`);
  console.log('  3. 看判决，再决定这条案例「应该」是什么。先跑后写 expected.json，别先写答案。');
  return 0;
}

const TEMPLATE = {
  schema_version: 'agent-web/0.1',
  id: 'example/todo',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '用一句话描述 Agent 要达成的业务目标。',
    goal_assertions: [
      { kind: 'entity_exists', selector: { collection: 'orders' } },
      { kind: 'field_equals', selector: { collection: 'orders', index: 0 }, path: 'status', value: 'PICKED' },
    ],
    invariants: [],
    allowed_capabilities: ['order.create', 'order.pick'],
  },
  reference_trajectory: [
    // as 写角色，不写具体账号：角色到身份的映射是适配器的责任。
    { id: 's1', capability: 'order.create', as: 'customer', expected_outcome: 'applied', arguments: {} },
  ],
  observability: { declared_scopes: ['orders'] },
};

async function cmdCompare(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web compare <案例文件或目录> --adapters=memory,taixianglian');
    return 2;
  }
  const names = String(flags.adapters ?? 'memory')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const name of names) {
    const pre = await precheckManifest(name);
    if (!pre.ok) {
      for (const line of pre.lines) console.error(line);
      return 2;
    }
  }
  const files = collectCaseFiles(args[0]);

  const matrix = new Map();
  const views = new Map();
  for (const name of names) {
    const adapter = await makeAdapter(name);
    const m = await adapter.manifest();
    views.set(name, m.view);
    for (const f of files) {
      const r = await runOne(f, adapter, {
        adapterName: name,
        timeoutMs: numFlag(flags.timeout),
        trajectory: loadTrajectory(flags.trajectory, f),
      });
      const id = r.case_id ?? path.basename(f, '.json');
      if (!matrix.has(id)) matrix.set(id, {});
      matrix.get(id)[name] = { status: r.status, reason: r.reason_code };
    }
  }

  const ids = [...matrix.keys()].sort();
  const pad = (t, w) => t + " ".repeat(Math.max(0, w - [...t].length));
  // 路径形态的适配器名会把表格撑爆，显示时只留文件名；查找仍用全名。
  const disp = names.map((n) => (n.length > 24 ? path.basename(n).replace(/\.(mjs|cjs|js)$/, '') : n));
  const width = Math.max(...ids.map((i) => [...i].length), 8) + 2;
  const colW = Math.max(...disp.map((n) => [...n].length), 9) + 2;

  console.log(pad("案例", width) + disp.map((n) => pad(n, colW)).join("") + "判决一致");
  console.log("-".repeat(width + colW * names.length + 8));

  let same = 0;
  for (const id of ids) {
    const row = matrix.get(id);
    const statuses = names.map((n) => row[n].status);
    const agree = statuses.every((t) => t === statuses[0]);
    if (agree) same += 1;
    const cells = names.map((n) => pad(row[n].status, colW)).join("");
    const mark = agree ? "✓" : "✗ " + statuses.join(" vs ");
    console.log(pad(id, width) + cells + mark);
  }

  console.log("");
  const rate = ((same / ids.length) * 100).toFixed(1);
  console.log("跨适配器判决一致率 " + rate + "% (" + same + "/" + ids.length + ")");
  if (same !== ids.length) {
    console.log("不一致本身就是信号：要么案例假设了某个实现的细节，要么两侧真的不同。");
  }

  // 判决一致还不够：两个适配器的视图契约也得一致，否则这份一致只是碰巧
  // ——它们各自在不同的字段上被判，恰好结论相同。
  if (names.length >= 2) {
    console.log("");
    console.log("视图契约");
    const base = names[0];
    let incompatible = 0;
    for (let i = 1; i < names.length; i += 1) {
      const other = names[i];
      const d = diffViews(views.get(base), views.get(other));
      if (d.compatible) {
        const n = Object.keys(views.get(base)?.collections ?? {}).length;
        console.log(`  ${base} 与 ${other}：兼容（${n} 个集合逐字相同）`);
      } else {
        incompatible += 1;
        console.log(`  ${base} 与 ${other}：不兼容`);
        for (const k of d.onlyA) console.log(`    - ${k} 只在 ${base} 声明`);
        for (const k of d.onlyB) console.log(`    - ${k} 只在 ${other} 声明`);
        for (const line of d.differences) console.log(`    - ${line}`);
      }
    }
    if (incompatible > 0 && same === ids.length) {
      // 只有「判决全同 + 视图不同」才是危险组合：绿得整齐，但没有可比性。
      console.log("  视图不同而判决相同：这份一致是碰巧，不是等价。先统一视图契约再对照。");
    }
  }

  return same === ids.length ? 0 : 1;
}

function loadVerdicts(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error('找不到 ' + abs);
  const out = new Map();
  for (const line of fs.readFileSync(abs, 'utf8').split(String.fromCharCode(10))) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    out.set(v.case_id, v);
  }
  return out;
}

// 规范视图漂移：两次跑批的初态指纹不一样，说明被测应用的结构变了。
// 这不是判决错误，而是"案例还能不能代表当初那个应用"的问题。
async function cmdDrift(args) {
  if (args.length < 2) {
    console.error('用法：agent-web drift <旧.jsonl> <新.jsonl>');
    return 2;
  }
  const A = loadVerdicts(args[0]);
  const B = loadVerdicts(args[1]);
  const ids = [...new Set([...A.keys(), ...B.keys()])].sort();

  const fp = (v) => (v && v.evidence && v.evidence.initial ? fingerprint(v.evidence.initial) : null);
  const pad = (t, w) => t + ' '.repeat(Math.max(0, w - [...t].length));
  const width = Math.max(...ids.map((i) => [...String(i)].length), 10) + 2;

  let same = 0;
  let drifted = 0;
  let onlyA = 0;
  let onlyB = 0;
  console.log(pad('案例', width) + pad('结果', 12) + '初态指纹');
  for (const id of ids) {
    const va = A.get(id);
    const vb = B.get(id);
    const fa = fp(va);
    const fb = fp(vb);
    let mark;
    if (!va) { mark = '只在旧'; onlyA += 0; onlyB += 1; }
    else if (!vb) { mark = '只在新'; onlyA += 1; }
    else if (!fa || !fb) { mark = '无观测'; }
    else if (fa === fb) { mark = '一致'; same += 1; }
    else { mark = '漂移'; drifted += 1; }
    const shown = fa && fb && fa !== fb ? fa.slice(0, 14) + ' → ' + fb.slice(0, 14) : (fa ?? fb ?? '-');
    console.log(pad(String(id), width) + pad(mark, 12) + shown);
  }
  console.log('');
  console.log(`一致 ${same} / 漂移 ${drifted} / 只在旧 ${onlyA} / 只在新 ${onlyB}`);
  if (drifted > 0) {
    console.log('初态形状变了：案例可能已不再描述同一个应用，先复核再信这份判决。');
  }
  return drifted > 0 ? 1 : 0;
}

async function cmdRecord(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web record <动作日志> --adapter=SPEC --out=<文件> [--case=<案例id>]');
    return 2;
  }
  const adapterName = flags.adapter ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const manifest = await adapter.manifest();
  const logPath = path.resolve(args[0]);
  if (!fs.existsSync(logPath)) {
    console.error('找不到日志 ' + logPath);
    return 2;
  }

  const { entryCount, doc } = recordTrajectory({
    text: fs.readFileSync(logPath, 'utf8'),
    manifest,
    adapter,
    producedBy: typeof flags.case === 'string' ? path.basename(logPath) : path.basename(logPath),
    includeReads: flags['include-reads'] === true || flags['include-reads'] === 'true',
  });

  if (typeof flags.case === 'string') doc.note = '由 record 从 ' + path.basename(logPath) + ' 还原，对应案例 ' + flags.case;

  const out = typeof flags.out === 'string' ? flags.out : null;
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), JSON.stringify(doc, null, 2) + String.fromCharCode(10), 'utf8');
  }

  console.log('读入 ' + entryCount + ' 条动作，还原出 ' + doc.trajectory.length + ' 步');
  for (const s of doc.trajectory) {
    const arg = s.bindings ? JSON.stringify(s.bindings) : JSON.stringify(s.arguments ?? {});
    console.log('  ' + s.id + ' ' + s.capability + ' as=' + s.as + ' ' + s.expected_outcome + ' ' + arg);
  }
  if (doc.skipped && doc.skipped.length > 0) {
    const by = {};
    for (const x of doc.skipped) by[x.reason] = (by[x.reason] ?? 0) + 1;
    console.log('');
    console.log('跳过 ' + doc.skipped.length + ' 条：' + Object.entries(by).map(([k, n]) => k + '×' + n).join(' '));
  }
  if (out) console.log('');
  if (out) console.log('已写入 ' + out);
  return doc.trajectory.length > 0 ? 0 : 1;
}

function findSensitiveFields(value, prefix = '', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findSensitiveFields(item, prefix + '[' + index + ']', found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const at = prefix ? prefix + '.' + key : key;
      if (/password|passwd|secret|token|authorization|cookie|api[_-]?key/i.test(key)) {
        found.push(at);
      } else {
        findSensitiveFields(item, at, found);
      }
    }
  }
  return found;
}

function writeNewFileSet(files, outDir) {
  const collisions = files.filter(({ file }) => fs.existsSync(file));
  if (collisions.length > 0) {
    throw new Error('为避免覆盖已有文件，未写入任何内容：' + collisions.map(({ file }) => file).join('、'));
  }

  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  try {
    for (const { file, content } of files) {
      fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' });
      written.push(file);
    }
  } catch (e) {
    for (const file of written) {
      try { fs.unlinkSync(file); } catch { /* 保留原始写入错误 */ }
    }
    throw e;
  }
}

// prepare：从一次请求日志直接产出三个可交接文件。
// 和手动串 record → draft → flow 不同，这里只回放一次，并且不把草稿判成绿色成绩。
async function cmdPrepare(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web prepare <动作日志> --adapter=SPEC [--out-dir=目录] [--id=案例id] [--goal="..."] [--seed=JSON]');
    return 2;
  }

  const logPath = path.resolve(args[0]);
  if (!fs.existsSync(logPath) || !fs.statSync(logPath).isFile()) {
    console.error('找不到动作日志文件 ' + logPath);
    return 2;
  }

  const base = path.basename(logPath, path.extname(logPath)) || 'case';
  const outDir = path.resolve(typeof flags['out-dir'] === 'string'
    ? flags['out-dir']
    : path.join('agent-web-output', base));
  const outputs = [
    path.join(outDir, 'trajectory.json'),
    path.join(outDir, 'case.draft.json'),
    path.join(outDir, 'case.flow.html'),
  ];
  if (fs.existsSync(outDir) && !fs.statSync(outDir).isDirectory()) {
    console.error('输出路径已存在但不是目录：' + outDir);
    return 2;
  }
  const existing = outputs.filter((file) => fs.existsSync(file));
  if (existing.length > 0) {
    console.error('为避免覆盖已有文件，停止执行：');
    for (const file of existing) console.error('  - ' + file);
    console.error('请换一个 --out-dir。');
    return 2;
  }

  const adapterName = flags.adapter ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const manifest = await adapter.manifest();
  let seed = {};
  if (typeof flags.seed === 'string') {
    try {
      seed = JSON.parse(flags.seed);
    } catch (e) {
      console.error('--seed 不是合法 JSON：' + e.message);
      return 2;
    }
  }

  const { entryCount, doc } = recordTrajectory({
    text: fs.readFileSync(logPath, 'utf8'),
    manifest,
    adapter,
    producedBy: path.basename(logPath),
    includeReads: flags['include-reads'] === true || flags['include-reads'] === 'true',
  });
  if (typeof flags.id === 'string') {
    doc.note = '由 prepare 从 ' + path.basename(logPath) + ' 还原，对应案例 ' + flags.id;
  }
  if (doc.trajectory.length === 0) {
    console.error('没有还原出可执行步骤，不生成文件。');
    for (const item of doc.skipped ?? []) console.error('  - ' + item.reason + ': ' + item.detail);
    return 1;
  }

  const stepErrors = validateSteps(doc.trajectory, 'trajectory');
  if (stepErrors.length > 0) {
    console.error('还原出的步骤未通过检查，不生成文件：');
    for (const error of stepErrors) console.error('  - ' + error);
    return 1;
  }

  const secrets = findSensitiveFields(doc.trajectory);
  if (secrets.length > 0) {
    console.error('步骤参数里发现疑似敏感字段，不会写入文件：' + secrets.join('、'));
    console.error('请先从日志或连接程序中移除密码、令牌、Cookie 等字段，再重新运行。');
    return 2;
  }

  const replay = await replayTrajectory({
    adapter,
    steps: doc.trajectory,
    scopes: manifest.scopes,
    seed,
  });
  if (!replay.ok) {
    console.error('步骤无法在当前测试系统上重放：' + replay.aborted.code +
      (replay.aborted.at !== undefined ? ' @ step[' + replay.aborted.at + ']' : ''));
    console.error('  ' + replay.aborted.detail);
    console.error('未生成文件。检查连接地址、账号角色和日志内容。');
    return 1;
  }

  const caseId = typeof flags.id === 'string' ? flags.id : 'draft/' + base;
  const { case: c, synth } = buildDraftCase({
    id: caseId,
    adapterName: manifest.adapter ?? adapterName,
    seed,
    source: path.relative(process.cwd(), logPath).split(path.sep).join('/'),
    steps: doc.trajectory,
    initial: replay.initial,
    final: replay.final,
    trace: replay.trace,
    manifest,
    scopes: manifest.scopes,
    goal: typeof flags.goal === 'string' ? flags.goal : '',
  });

  const caseErrors = validateCase(c);
  const realErrors = synth.goal_assertions.length === 0
    ? caseErrors.filter((error) => !error.includes('goal_assertions'))
    : caseErrors;
  if (realErrors.length > 0) {
    console.error('生成的案例草稿未通过格式检查，不生成文件：');
    for (const error of realErrors) console.error('  - ' + error);
    return 1;
  }
  if (synth.goal_assertions.length === 0) {
    console.error('这次运行没有留下可检查的目标结果，不生成文件。');
    return 1;
  }

  const caseSecrets = findSensitiveFields(c);
  if (caseSecrets.length > 0) {
    console.error('案例草稿里发现疑似敏感字段，不会写入文件：' + caseSecrets.join('、'));
    return 2;
  }

  const trajectoryJson = JSON.stringify(doc, null, 2) + '\n';
  const caseJson = JSON.stringify(c, null, 2) + '\n';
  const flowHtml = renderFlowHtml({ case: c, title: c.id });
  try {
    writeNewFileSet([
      { file: outputs[0], content: trajectoryJson },
      { file: outputs[1], content: caseJson },
      { file: outputs[2], content: flowHtml },
    ], outDir);
  } catch (e) {
    console.error('写入失败：' + e.message);
    return 2;
  }

  const skipped = doc.skipped ?? [];
  console.log('准备完成：读入 ' + entryCount + ' 条请求，还原出 ' + doc.trajectory.length + ' 步' +
    (skipped.length ? '，另有 ' + skipped.length + ' 条请求需要查看' : ''));
  if (skipped.length > 0) {
    const reasons = {};
    for (const item of skipped) reasons[item.reason] = (reasons[item.reason] ?? 0) + 1;
    console.log('  未纳入步骤：' + Object.entries(reasons).map(([reason, count]) => reason + ' × ' + count).join('；'));
    console.log('  每条具体原因见 trajectory.json 的 skipped 列表。');
  }
  console.log('输出目录：' + path.relative(process.cwd(), outDir));
  console.log('  trajectory.json    可重放步骤');
  console.log('  case.draft.json    未确认的检查清单');
  console.log('  case.flow.html     离线流程预览');
  console.log('');
  console.log('下一步：打开流程预览并检查 case.draft.json。草稿从实际发生的事生成，自检通过不代表检查规则正确。');
  console.log('补好目标和负例、确认规则后，再运行：');
  console.log('  node bin/agent-web.mjs verify ' + path.relative(process.cwd(), outputs[1]) +
    ' --adapter=' + (manifest.adapter ?? adapterName));
  return 0;
}

// draft：把一条轨迹回放一遍，从实际终态反推案例草稿。
// 它的产物一定是 pass —— 断言就是从这次运行的终态抄下来的。
// 所以这一步不是"生成测试"，是"把人要想的部分从零开始压到几条待确认"。
async function cmdDraft(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web draft <轨迹文件> --adapter=SPEC [--out=案例.json] [--id=前缀/名字] [--goal="..."]');
    return 2;
  }
  const trajPath = path.resolve(args[0]);
  if (!fs.existsSync(trajPath)) {
    console.error('找不到轨迹文件 ' + trajPath);
    return 2;
  }
  const raw = JSON.parse(fs.readFileSync(trajPath, 'utf8'));
  const steps = Array.isArray(raw) ? raw : Array.isArray(raw?.trajectory) ? raw.trajectory : null;
  if (!steps || steps.length === 0) {
    console.error('轨迹文件里没有非空的 trajectory 数组：' + trajPath);
    return 2;
  }
  const stepErrors = validateSteps(steps, 'trajectory');
  if (stepErrors.length > 0) {
    console.error('轨迹未通过结构校验，不进入回放：');
    for (const e of stepErrors) console.error('  - ' + e);
    return 1;
  }

  const adapterName = flags.adapter ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const manifest = await adapter.manifest();
  const scopes = manifest.scopes;
  let seed = {};
  if (typeof flags.seed === 'string') {
    try {
      seed = JSON.parse(flags.seed);
    } catch (e) {
      console.error('--seed 不是合法 JSON：' + e.message);
      return 2;
    }
  }

  const replay = await replayTrajectory({ adapter, steps, scopes, seed });
  if (!replay.ok) {
    // 轨迹回放不通，就没有"实际终态"可抄。这时候继续往下写，写出来的全是想象。
    console.error('回放中断：' + replay.aborted.code + (replay.aborted.at !== undefined ? ' @ step[' + replay.aborted.at + ']' : ''));
    console.error('  ' + replay.aborted.detail);
    console.error('这条轨迹在这个适配器上跑不通，没有终态可依据，不生成草稿。');
    return 1;
  }

  const base = path.basename(trajPath).replace(/\.json$/i, '');
  const caseId = typeof flags.id === 'string' ? flags.id : 'draft/' + base;
  const { case: c, synth } = buildDraftCase({
    id: caseId,
    adapterName: manifest.adapter ?? adapterName,
    seed,
    source: (path.relative(process.cwd(), trajPath) || base).split(path.sep).join('/'),
    steps,
    initial: replay.initial,
    final: replay.final,
    trace: replay.trace,
    manifest,
    scopes,
    goal: typeof flags.goal === 'string' ? flags.goal : '',
  });

  const caseErrors = validateCase(c);
  // 一条断言都没合成出来时，格式校验会先报「goal_assertions 必须是非空数组」。
  // 那是结果，不是原因 —— 原因在上面那张终态表里，交给下面的空断言分支说。
  const realErrors = synth.goal_assertions.length === 0
    ? caseErrors.filter((e) => !e.includes('goal_assertions'))
    : caseErrors;
  if (realErrors.length > 0) {
    console.error('生成的草稿未通过案例格式校验（这是 draft 自己的 bug，不是你的）：');
    for (const e of realErrors) console.error('  - ' + e);
    return 1;
  }

  const pad = (t, w) => String(t) + ' '.repeat(Math.max(0, w - [...String(t)].length));
  console.log('回放 ' + steps.length + ' 步，终态如下（初态指纹 ' + fingerprint(replay.initial) + '）');
  const w = Math.max(...synth.summary.map((s) => [...s.collection].length), 8) + 2;
  for (const s of synth.summary) {
    const mark = s.delta === 0 ? '未变' : (s.delta > 0 ? '+' : '') + s.delta;
    console.log('  ' + pad(s.collection, w) + pad(s.before + ' -> ' + s.after, 12) + mark);
  }

  const noteFor = (at) => synth.notes.find((n) => n.at === at);
  console.log('');
  console.log('目标断言 ' + synth.goal_assertions.length + ' 条');
  if (synth.goal_assertions.length === 0) {
    console.log('  （一条也没生成）');
  }
  synth.goal_assertions.forEach((a, i) => {
    console.log('  [' + i + '] ' + JSON.stringify(a));
    const n = noteFor('goal[' + i + ']');
    if (n) console.log('      └ ' + n.why);
  });

  if (synth.invariants.length > 0) {
    console.log('');
    console.log('不变量 ' + synth.invariants.length + ' 条');
    synth.invariants.forEach((a, i) => {
      console.log('  [' + i + '] ' + JSON.stringify(a));
      const n = noteFor('invariant[' + i + ']');
      if (n) console.log('      └ ' + n.why);
    });
  }

  console.log('');
  console.log('待确认 ' + synth.todo.length + ' 条');
  for (const t of synth.todo) console.log('  - ' + t);

  if (synth.goal_assertions.length === 0) {
    console.log('');
    console.error('回放没有产出任何目标断言：这条轨迹没有留下可判的终态痕迹，不写文件。');
    return 1;
  }

  const out = typeof flags.out === 'string' ? path.resolve(flags.out) : null;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(c, null, 2) + '\n', 'utf8');
  }

  // 自检：拿草稿自己跑一遍。跑不过说明草稿内部不自洽（多半是选择器写歪了），
  // 跑得过也只是一句「能跑」，不是「判据对」—— 这两句话必须分开说。
  const self = await judge({ case: c, adapter, adapterName: manifest.adapter ?? adapterName });
  console.log('');
  console.log('草稿自检：' + self.status + '（' + self.reason_code + '）—— 这只说明格式合法、可重放，不说明判据正确。');
  if (out) console.log('已写入 ' + path.relative(process.cwd(), out));
  return self.status === 'pass' ? 0 : 1;
}

// flow：把案例/候选轨迹与可选判决结果渲染为独立 HTML。
// 纯展示、不执行适配器。HTML 内嵌所有数据与样式，file:// 直接打开。
function parseJsonOrLines(text, label) {
  try {
    return JSON.parse(text);
  } catch (jsonError) {
    const lines = String(text).split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length === 0) throw new Error(label + ' 为空');
    try {
      return lines.map((line, i) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          throw new Error(label + ' 第 ' + (i + 1) + ' 行 JSON 错误：' + e.message);
        }
      });
    } catch (lineError) {
      if (lineError.message.startsWith(label + ' 第 ')) throw lineError;
      throw new Error(label + ' 不是合法 JSON / JSONL：' + jsonError.message);
    }
  }
}

function readFlowTrajectory(spec, caseFile) {
  if (typeof spec !== 'string') return null;
  let target = path.resolve(spec);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, path.basename(caseFile));
  }
  if (!fs.existsSync(target)) throw new Error('找不到候选轨迹 ' + target);
  const raw = parseJsonOrLines(fs.readFileSync(target, 'utf8'), '候选轨迹');
  const steps = Array.isArray(raw) ? raw : Array.isArray(raw?.trajectory) ? raw.trajectory : null;
  if (!steps || steps.length === 0) throw new Error('候选轨迹文件必须是非空数组或含 trajectory 数组的对象');
  const errors = validateSteps(steps, 'trajectory');
  if (errors.length > 0) throw new Error('候选轨迹未通过校验：' + errors.join('；'));
  return steps;
}

function readFlowVerdict(spec, caseId) {
  if (typeof spec !== 'string') return null;
  const target = path.resolve(spec);
  if (!fs.existsSync(target)) throw new Error('找不到判决结果 ' + target);
  const raw = parseJsonOrLines(fs.readFileSync(target, 'utf8'), '判决结果');
  const rows = Array.isArray(raw) ? raw : [raw];
  const verdict = rows.find((row) => row?.case_id === caseId);
  if (!verdict) throw new Error('判决结果里没有 case_id=' + caseId);
  return verdict;
}

function loadVerdictMap(target) {
  if (!fs.existsSync(target)) throw new Error('找不到判决结果 ' + target);
  const raw = parseJsonOrLines(fs.readFileSync(target, 'utf8'), '判决结果');
  const rows = Array.isArray(raw) ? raw : [raw];
  const map = new Map();
  for (const row of rows) if (row?.case_id) map.set(row.case_id, row);
  return map;
}

function cmdFlowDashboard(dir, flags) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'expected.json').sort();
  if (files.length === 0) {
    console.error('目录里没有案例文件（expected.json 不算案例）。' + dir);
    return 2;
  }
  const verdictMap = typeof flags.result === 'string' ? loadVerdictMap(path.resolve(flags.result)) : null;
  const cases = [];
  for (const file of files) {
    const rawCase = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const caseErrors = validateCase(rawCase);
    if (caseErrors.length > 0) {
      console.error('案例 ' + file + ' 未通过校验：');
      for (const error of caseErrors) console.error('  - ' + error);
      return 1;
    }
    cases.push({ case: rawCase, verdict: verdictMap ? (verdictMap.get(rawCase.id) ?? null) : null });
  }
  const title = typeof flags.title === 'string' ? flags.title : path.basename(dir) + ' · 判决总览';
  const html = renderDashboardHtml({ cases, title });
  const out = typeof flags.out === 'string'
    ? path.resolve(flags.out)
    : path.resolve(path.basename(dir) + '.flow.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  const withResult = cases.filter((entry) => entry.verdict).length;
  console.log('总览页已生成：' + path.relative(process.cwd(), out));
  console.log('案例：' + cases.length + ' · 有判决：' + withResult);
  if (verdictMap) {
    for (const entry of cases) {
      if (!verdictMap.has(entry.case.id)) console.log('提示：判决结果里没有 ' + entry.case.id + '，该案例按未运行显示。');
    }
  }
  console.log('HTML 自包含，可直接用浏览器打开。');
  return 0;
}
function cmdFlow(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web flow <案例.json或目录> [--trajectory=轨迹.json或目录] [--result=判决.json或.jsonl] [--out=流程.html]');
    return 2;
  }
  const caseFile = path.resolve(args[0]);
  if (!fs.existsSync(caseFile)) {
    console.error('找不到案例文件或目录 ' + caseFile);
    return 2;
  }
  if (fs.statSync(caseFile).isDirectory()) {
    return cmdFlowDashboard(caseFile, flags);
  }
  if (!fs.statSync(caseFile).isFile()) {
    console.error('不是案例文件 ' + caseFile);
    return 2;
  }
  const rawCase = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
  const caseErrors = validateCase(rawCase);
  if (caseErrors.length > 0) {
    console.error('案例未通过校验：');
    for (const error of caseErrors) console.error('  - ' + error);
    return 1;
  }

  const trajectory = readFlowTrajectory(flags.trajectory, caseFile);
  const verdict = readFlowVerdict(flags.result, rawCase.id);
  if (trajectory && verdict && verdict.trajectory_source !== 'candidate') {
    throw new Error('传入了候选轨迹，但 --result 不是 candidate 判决，不能把不同轨迹的步骤对齐；请用 verify --trajectory 重新生成结果');
  }
  const title = typeof flags.title === 'string' ? flags.title : rawCase.id;
  const html = renderFlowHtml({ case: rawCase, trajectory, verdict, title });
  const out = typeof flags.out === 'string'
    ? path.resolve(flags.out)
    : path.resolve(path.basename(caseFile, path.extname(caseFile)) + '.flow.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, 'utf8');

  console.log('流程图已生成：' + path.relative(process.cwd(), out));
  console.log('案例：' + rawCase.id + ' · ' + (trajectory ? 'candidate' : 'reference') + ' trajectory');
  const displayedSteps = trajectory
    ?? (verdict?.trajectory_source === 'candidate' && Array.isArray(verdict.evidence?.trace)
      ? verdict.evidence.trace
      : rawCase.reference_trajectory);
  console.log('步骤：' + displayedSteps.length + ' · 判决：' + (verdict?.status ?? '未提供'));
  if (verdict?.trajectory_source === 'candidate' && !trajectory) {
    console.log('提示：当前显示已执行步骤；要显示尚未执行的候选步骤与动作参数，另传 --trajectory=轨迹文件或目录。');
  }
  console.log('HTML 自包含，可直接用浏览器打开。');
  return 0;
}

function announceCandidateMode(flags) {
  if (typeof flags.trajectory !== 'string' || flags.json) return;
  // 候选轨迹模式下，expected.json 描述的是参考轨迹，落差是结论而不是错误。
  console.log('候选轨迹模式：判的是 --trajectory 目录里的动作序列，不是案例自带的参考轨迹。');
  console.log('下面的 ✓/✗ 相对 expected.json 的参考基线，落差本身就是要看的东西。');
  console.log('');
}

const HELP = `agent-web —— 给 Agent 写机器可判的集成测试

  agent-web selftest [--json]                 零依赖自测：内置适配器 + 内置案例
  agent-web verify <目录或文件> --adapter=SPEC 跑案例出判决
  agent-web report <results.jsonl>            由判决结果出指标
  agent-web accept <文件> --by=NAME     确认草稿，确认后才能判决
  agent-web capabilities [--adapter=SPEC]     打印能力清单与证据等级
  agent-web coverage <案例> --adapter=SPEC    能力覆盖率对账（--min=0.8 设门槛）
  agent-web probe --adapter=SPEC              探针：查适配器自己有没有在撒谎
  agent-web certify <案例> --adapter=SPEC     判据准入：变异体 × 断言杀伤矩阵
  agent-web breed --adapter=SPEC --out=目录   照着视图形状自动生成变异体
  agent-web drill <案例> --adapter=SPEC       出题：对真盲区出题（题面不含答案）
  agent-web drill grade <题目> --submissions=DIR  批改：只认跑出来的结果
  console.error('      --allow-missed：答了就必须对，没答的照实报（默认要求答满）');
  agent-web compare <案例> --adapters=A,B     同一份案例喂多个实现，比判决
  agent-web drift <旧.jsonl> <新.jsonl>      比较两次跑批的初态形状（漂移检测）
  agent-web record <动作日志> --adapter=SPEC   把 Agent 的实际动作还原成候选轨迹
  agent-web prepare <动作日志> --adapter=SPEC  一次生成步骤、案例草稿和流程预览
  agent-web draft <轨迹文件> --adapter=SPEC   回放轨迹，反推案例草稿（要人确认）
  agent-web flow <案例或目录> [--result=FILE]  单案例流程图；给目录则生成判决总览
  agent-web crosscheck --adapter=SPEC         交叉复核：不经过适配器自己的 fetch 再发一遍，比对响应
  agent-web discover <网址> --out=DIR         探一个站点：生成只读适配器、案例草稿和施工单
  agent-web import hurl <文件|目录> --out=DIR 把 hurl 套件转成案例草稿（不联网）
  agent-web tap --target=URL                  录五分钟：流量长出适配器、孪生与案例
  agent-web learn <traffic.jsonl> --out=DIR  把录制学成四件东西（yaml/孪生/案例/认不出的）
  agent-web mutants                           变异体目录：谁的坏法、怎么抓、怎么投稿
  agent-web ingest <报告.json> [--from=e2e]    把别家的测试报告翻成三值判决，数清机器判定占比
  agent-web align <参照视图> <目标视图> [--out=align.yml]  跨命名体系的字段映射提议
  agent-web negatives <案例或目录> --adapter=SPEC  按声明派生负例候选（全部 disputed，只出审阅表）
  agent-web preflight <案例或目录> --adapter=SPEC  跑之前预检：预测 ready / unknown / fail，与预期对账
  agent-web audit <真实.jsonl> <候选.jsonl>    假绿审计：拿真实后端当尺子量候选实现
  agent-web traps <结果.jsonl> --cases=DIR    陷阱普查：这批判决有多少是盲的
  agent-web knowledge                         事故档案：这个仓库踩过的 ${ENTRIES.length} 个坑
  agent-web recall [案例目录]                 比对档案：这次有没有重犯旧错（第二次拦下）
  agent-web init <目录>                       生成案例模板（--adapter 写进 environment）
  agent-web version                           版本、最近一次变更、以及版本号三处是否一致

适配器 SPEC 可以是：
  内置名        ${listBuiltins().join(' / ')}
  文件路径      ./my-adapter.mjs（相对当前工作目录）
  包名          @acme/agent-web-adapter-order

  接自己的应用只需写一个 .mjs，导出 createAdapter()。见 examples/adapter-template/。

断言：${KINDS.join(' / ')}（共 ${KINDS.length} 种，相位见 docs/SPEC.md 第 4 章）
      没有 llm_judge，判不了就记 unknown，并留在分母里。

退出码：0 符合预期；1 存在不符；2 用法或环境错误。`;

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];
  const args = _.slice(1);

  // --version / -v 比任何子命令都优先：版本检查不该被参数解析的边角情况影响。
  if (flags.version || flags.v) return cmdVersion(flags);
  if (!cmd || flags.help || cmd === 'help') {
    console.log(HELP);
    // 主动要帮助是成功；什么参数都不给是用法错误。
    return flags.help || cmd === 'help' ? 0 : 2;
  }

  try {
    switch (cmd) {
    case 'import':
      return await cmdImport(args, flags);
      case 'selftest':
        return await cmdSelftest(flags);
      case 'verify':
        return await cmdVerify(args, flags);
      case 'report':
        return await cmdReport(args, flags);
      case 'compare':
        return await cmdCompare(args, flags);
      case 'record':
        return await cmdRecord(args, flags);
      case 'prepare':
        return await cmdPrepare(args, flags);
      case 'draft':
        return await cmdDraft(args, flags);
      case 'flow':
        return cmdFlow(args, flags);
      case 'drift':
        return await cmdDrift(args);
      case 'capabilities':
        return await cmdCapabilities(args, flags);
      case 'traps':
        return await cmdTraps(args, flags);
      case 'certify':
        return await cmdCertify(args, flags);
      case 'breed':
        return await cmdBreed(args, flags);
      case 'align':
        return await cmdAlign(args, flags);
      case 'negatives':
        return await cmdNegatives(args, flags);
      case 'preflight':
        return await cmdPreflight(args, flags);
      case 'mutants':
        return cmdMutants(args, flags);
      case 'drill':
        return await cmdDrill(args, flags);
      case 'audit':
        return await cmdAudit(args, flags);
      case 'accept':
        return cmdAccept(args, flags);
      case 'version':
      return cmdVersionReport(flags);
      case 'knowledge':
      return cmdKnowledge(flags);
    case 'recall':
      return cmdRecall(args, flags);
    case 'ingest':
      return cmdIngest(args, flags);
    case 'crosscheck':
        return await cmdCrosscheck(args, flags);
    case 'discover':
        return await cmdDiscover(args, flags);
    case 'tap':
        return await cmdTap(args, flags);
    case 'learn':
        return cmdLearn(args, flags);
    case 'probe':
        return await cmdProbe(flags);
      case 'coverage':
        return await cmdCoverage(args, flags);
      case 'init':
        return cmdInit(args, flags);
      default:
        console.error(`未知命令 ${cmd}`);
        console.log(HELP);
        return 2;
    }
  } catch (e) {
    console.error(`错误：${e && e.message}`);
    return 2;
  }
}

// 用 process.exitCode 而不是 process.exit()：
// stdout 是管道时（CI 里就是），console.log 是异步写入的，process.exit() 会**截断**还没写出去的内容。
// 一份 143KB 的 --json 输出在 CI 上被切成 143204 字节的半截 JSON，本地却一切正常，
// 根因就在这里。设 exitCode 让进程自己等 stdout 排空再退出。
main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  console.error(`未捕获：${e && e.stack ? e.stack : e}`);
  process.exitCode = 2;
});

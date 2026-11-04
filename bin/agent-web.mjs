#!/usr/bin/env node
/**
 * agent-web CLI
 *
 *   agent-web selftest                 零依赖自测：内置适配器 + 内置案例
 *   agent-web verify <目录或文件>       对指定适配器跑案例，出判决
 *   agent-web report <results.jsonl>   由判决结果出指标
 *   agent-web capabilities             打印适配器的能力清单与证据等级
 *   agent-web draft <轨迹文件>          回放一条轨迹，反推案例草稿
 *   agent-web init <目录>              生成一份案例模板
 *
 * 退出码：0 全部符合预期；1 存在不符；2 用法或环境错误。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { judge } from '../src/runner.mjs';
import { fingerprint } from '../src/values.mjs';
import { recordTrajectory } from '../src/record.mjs';
import { replayTrajectory, buildDraftCase } from '../src/draft.mjs';
import { validateCase, validateSteps } from '../src/case.mjs';
import { summarize, agreement, formatText, countFailedAssertions } from '../src/report.mjs';
import { loadAdapter, listBuiltins } from '../src/adapter/load.mjs';
import { diffViews } from '../src/view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

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
  const dir = path.join(ROOT, 'cases', 'memory-demo');
  const expected = readExpected(dir);
  const adapter = await makeAdapter('memory');
  announceCandidateMode(flags);
  const files = collectCaseFiles(dir);
  const verdicts = [];
  const selfOpts = { adapterName: 'memory', timeoutMs: numFlag(flags.timeout) };
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

async function cmdVerify(args, flags) {
  if (args.length === 0) {
    console.error('用法：agent-web verify <目录或文件> [--adapter=memory]');
    return 2;
  }
  const adapterName = flags.adapter ?? 'memory';
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
    fs.writeFileSync(out, verdicts.map((v) => JSON.stringify(v)).join('\n') + '\n', 'utf8');
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
    console.error('用法：agent-web report <results.jsonl> [--expected=<expected.json>]');
    return 2;
  }
  const lines = fs
    .readFileSync(path.resolve(args[0]), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '');
  const verdicts = lines.map((l) => JSON.parse(l));
  const expected = typeof flags.expected === 'string' ? JSON.parse(fs.readFileSync(path.resolve(flags.expected), 'utf8')) : {};
  const summary = summarize(verdicts);
  if (flags.json) {
    console.log(JSON.stringify({ summary, agreement: agreement(verdicts, expected) }, null, 2));
  } else {
    console.log(formatText(summary, { agreement: Object.keys(expected).length ? agreement(verdicts, expected) : null }));
  }
  return 0;
}

async function cmdCapabilities(args, flags) {
  const adapterName = flags.adapter ?? args[0] ?? 'memory';
  const adapter = await makeAdapter(adapterName);
  const m = await adapter.manifest();
  console.log(JSON.stringify(m, null, 2));
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
  const files = collectCaseFiles(args[0]);
  const names = String(flags.adapters ?? 'memory')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

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

function announceCandidateMode(flags) {  if (typeof flags.trajectory !== 'string' || flags.json) return;
  // 候选轨迹模式下，expected.json 描述的是参考轨迹，落差是结论而不是错误。
  console.log('候选轨迹模式：判的是 --trajectory 目录里的动作序列，不是案例自带的参考轨迹。');
  console.log('下面的 ✓/✗ 相对 expected.json 的参考基线，落差本身就是要看的东西。');
  console.log('');
}

const HELP = `agent-web —— 给 Agent 写机器可判的集成测试

  agent-web selftest [--json]                 零依赖自测：内置适配器 + 内置案例
  agent-web verify <目录或文件> --adapter=SPEC 跑案例出判决
  agent-web report <results.jsonl>            由判决结果出指标
  agent-web capabilities [--adapter=SPEC]     打印能力清单与证据等级
  agent-web compare <案例> --adapters=A,B     同一份案例喂多个实现，比判决
  agent-web drift <旧.jsonl> <新.jsonl>      比较两次跑批的初态形状（漂移检测）
  agent-web record <动作日志> --adapter=SPEC  把 Agent 的实际动作还原成候选轨迹
  agent-web draft <轨迹文件> --adapter=SPEC   回放轨迹，反推案例草稿（要人确认）
  agent-web init <目录>                       生成案例模板（--adapter 写进 environment）

适配器 SPEC 可以是：
  内置名        ${listBuiltins().join(' / ')}
  文件路径      ./my-adapter.mjs（相对当前工作目录）
  包名          @acme/agent-web-adapter-order

  接自己的应用只需写一个 .mjs，导出 createAdapter()。见 examples/adapter-template/。

断言：entity_exists / field_equals / count_delta / status_transition /
      unchanged / event_absent / composite
      没有 llm_judge，判不了就记 unknown，并留在分母里。

退出码：0 符合预期；1 存在不符；2 用法或环境错误。`;

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0];
  const args = _.slice(1);

  if (!cmd || flags.help || cmd === 'help') {
    console.log(HELP);
    return cmd ? 0 : 2;
  }

  try {
    switch (cmd) {
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
      case 'draft':
        return await cmdDraft(args, flags);
      case 'drift':
        return await cmdDrift(args);
      case 'capabilities':
        return await cmdCapabilities(args, flags);
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

main().then((code) => process.exit(code));

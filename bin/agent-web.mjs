#!/usr/bin/env node
/**
 * agent-web CLI
 *
 *   agent-web selftest                 零依赖自测：内置适配器 + 内置案例
 *   agent-web verify <目录或文件>       对指定适配器跑案例，出判决
 *   agent-web report <results.jsonl>   由判决结果出指标
 *   agent-web capabilities             打印适配器的能力清单与证据等级
 *   agent-web init <目录>              生成一份案例模板
 *
 * 退出码：0 全部符合预期；1 存在不符；2 用法或环境错误。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { judge } from '../src/runner.mjs';
import { summarize, agreement, formatText, countFailedAssertions } from '../src/report.mjs';
import { loadAdapter, listBuiltins } from '../src/adapter/load.mjs';

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

async function runOne(caseFile, adapter) {
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
  return judge({ case: c, adapter });
}

async function cmdSelftest(flags) {
  const dir = path.join(ROOT, 'cases', 'memory-demo');
  const expected = readExpected(dir);
  const adapter = await makeAdapter('memory');
  const files = collectCaseFiles(dir);
  const verdicts = [];
  for (const f of files) verdicts.push(await runOne(f, adapter));

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

  const verdicts = [];
  for (const f of files) verdicts.push(await runOne(f, adapter));

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
  for (const name of names) {
    const adapter = await makeAdapter(name);
    for (const f of files) {
      const r = await runOne(f, adapter);
      const id = r.case_id ?? path.basename(f, '.json');
      if (!matrix.has(id)) matrix.set(id, {});
      matrix.get(id)[name] = { status: r.status, reason: r.reason_code };
    }
  }

  const ids = [...matrix.keys()].sort();
  const pad = (t, w) => t + " ".repeat(Math.max(0, w - [...t].length));
  const width = Math.max(...ids.map((i) => [...i].length), 8) + 2;
  const colW = Math.max(...names.map((n) => n.length), 9) + 2;

  console.log(pad("案例", width) + names.map((n) => pad(n, colW)).join("") + "判决一致");
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
  return same === ids.length ? 0 : 1;
}

const HELP = `agent-web —— 给 Agent 写机器可判的集成测试

  agent-web selftest [--json]                 零依赖自测：内置适配器 + 内置案例
  agent-web verify <目录或文件> --adapter=SPEC 跑案例出判决
  agent-web report <results.jsonl>            由判决结果出指标
  agent-web capabilities [--adapter=SPEC]     打印能力清单与证据等级
  agent-web compare <案例> --adapters=A,B     同一份案例喂多个实现，比判决
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

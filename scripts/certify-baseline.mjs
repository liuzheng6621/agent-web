#!/usr/bin/env node
/**
 * 准入基线闸门：漏网的变异体必须**正好**是这几个。
 *
 * 变异体目录会扩容，案例集目前还抓不住这四个观测层的坏法（案例只在数量为 1 的
 * 订单上断言过金额）。这个脚本的作用不是让 CI 变绿，而是让这个洞**不能悄悄变大、
 * 也不能悄悄消失**：多漏一个，说明新加的变异体和案例都失守；少漏一个而不改基线，
 * 说明有人补了断言却没更新记录。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 已知盲区：案例集当前确实没有对应刻度的地方。改这个表等于改一份公开的欠账清单。 */
const KNOWN_SURVIVORS = [
  'm-item-count-flattened',
  'm-pickup-no-offset',
  'm-total-single-unit',
  'm-subtotal-stale',
];

let report;
try {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'bin/agent-web.mjs'), 'certify', 'cases/coffee', '--adapter=memory', '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  report = JSON.parse(out);
} catch (e) {
  // certify 在存在漏网时退出码为 1，但 stdout 仍有完整 JSON：不要因此判为解析失败。
  if (!e.stdout) {
    console.error('准入基线：certify 没有输出，无法建立基线');
    process.exit(1);
  }
  report = JSON.parse(e.stdout);
}

const survivors = report.mutations.filter((m) => !m.caught).map((m) => m.id).sort();
const known = [...KNOWN_SURVIVORS].sort();
const grew = survivors.filter((id) => !known.includes(id));
const shrunk = known.filter((id) => !survivors.includes(id));

// 光"名字对得上"不够：每个欠账都必须被证明杀得掉。
// 如果某个变异体在任何案例上都造不出差异，它可能等价于原程序 —— 那不是欠账，
// 那是目录写错了。这种情况直接把基线判失败，让人回去看，而不是挂着一条永远清不掉的账。
const undetermined = report.mutations.filter((m) => !m.caught && m.status !== 'killable');
const noSuggestion = report.mutations.filter((m) => !m.caught && m.status === 'killable' && !m.suggestion);

if (undetermined.length > 0) {
  console.error(`准入基线：${undetermined.length} 个漏网变异体连"可观测差异"都造不出来`);
  for (const m of undetermined) {
    console.error(`  ${m.id}${m.equivalence ? '（投稿人声称等价：' + m.equivalence + '）' : ''}`);
  }
  console.error('  它们可能真的等价于原程序（那就不该留在目录里），也可能只是案例根本没走到那段逻辑。');
  console.error('  两种都不是"补一条断言"能解决的：先把案例走到，或者删掉这个变异体。');
  process.exit(1);
}

if (noSuggestion.length > 0) {
  console.error(`准入基线：${noSuggestion.length} 个欠账拿不出建议断言 —— 差异找得到，但没有模板能表达它`);
  for (const m of noSuggestion) console.error(`  ${m.id}  第一处差异在 ${m.witness?.path}`);
  console.error('  给 suggestFromWitness 补一个模板，或者手工写这条断言。');
  process.exit(1);
}

if (grew.length === 0 && shrunk.length === 0) {
  console.log(`准入基线：漏网 ${survivors.length} 个，与基线一致`);
  console.log(`  已知欠账：${known.join(' ')}`);
  console.log(`  抓到 ${report.mutations.length - survivors.length} / ${report.mutations.length}，${report.summary.suggestions} 条建议断言可补`);
  for (const m of report.mutations) {
    if (m.caught || !m.suggestion) continue;
    console.log(`    ${m.id} → ${m.suggestion.caseId}：${JSON.stringify(m.suggestion.assertion)}`);
  }
  process.exit(0);
}

if (grew.length > 0) {
  console.error(`准入基线：新出现 ${grew.length} 个漏网变异体 —— ${grew.join(' ')}`);
  console.error('  这是真的退步：案例集比基线更抓不住了，或者新变异体根本没被任何断言盯上。');
}
if (shrunk.length > 0) {
  console.error(`准入基线：${shrunk.length} 个基线里的漏洞已经被补上 —— ${shrunk.join(' ')}`);
  console.error('  好事，但要把 scripts/certify-baseline.mjs 的 KNOWN_SURVIVORS 一起改掉，否则基线在说谎。');
}
process.exit(1);

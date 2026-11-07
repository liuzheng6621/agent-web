/**
 * 展品 09 · 文档里的退出码，代码里根本不存在
 *
 * 这一件和前面八件不一样：它不涉及任何一行判定逻辑，坏的是**规范本身**。
 * SPEC 第 8 章从 v0.7.0 起写「3 = 用法错误」，而 bin/agent-web.mjs 里
 * 62 处 return 2、一处 return 3 都没有，--help 印的也是 2。
 *
 * 四十多个版本没人发现，原因很朴素：退出码只在各命令自己的测试里按需断言
 * （`assert.equal(r.exitCode, 2)`），没有任何测试拿第 8 章那张表当出处。
 * 每一条测试都对着自己那一小段，全绿；而「表里写的码 = 代码真的返回的码」
 * 这件事，从来没有一条测试在管。
 *
 * 这个仓库的宪法是「断言必须机器可判」。文档也是断言——它断言了程序的行为。
 * 既然断言必须机器可判，那就没有理由让一张行为表靠人眼对账。
 *
 * 展品喂给校验函数的是**修之前那张表**（含 3）。文档已经改对了，
 * 所以要用旧表来证明这个机制真的能抓住它，而不是拿「现在是对的」冒充「抓得住」。
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const meta = {
  id: 'e09-doc-drift',
  title: '规范写了退出码 3，代码里一处都没有',
  symptom: '文档说用法错误返回 3，实际返回 2；四十多个版本无人发现',
  mechanism: '退出码只在各命令自己的测试里按需断言，没人拿第 8 章那张表当出处',
  naive: 'pass',
  caught: 'fail',
  caughtCode: 'doc_code_mismatch',
};

const BIN = 'bin/agent-web.mjs';

/** 修之前那张表。文档现在是对的，所以要留一份旧样本来证明机制有效。 */
const LEGACY_DOC = ['| 码 | 含义 |', '| --- | --- |', '| 0 | 全部判决与预期一致 |', '| 1 | 存在不一致 |', '| 3 | 用法错误、路径不存在、适配器名未知 |'].join('\n');

/** 校验：表里写的码 = 代码真的返回的码。这就是第 8 章现在配的那条测试。 */
export function checkDocAgainstCode(docText, codeText) {
  const documented = new Set();
  for (const line of docText.split('\n')) {
    const m = /^\|\s*`?(\d+)`?\s*\|/.exec(line.trim());
    if (m) documented.add(Number(m[1]));
  }
  const actual = new Set();
  for (const m of codeText.matchAll(/\breturn\s+(\d+)\s*;/g)) actual.add(Number(m[1]));
  for (const m of codeText.matchAll(/\bprocess\.exit\((\d+)\)/g)) actual.add(Number(m[1]));

  const extra = [...actual].filter((c) => !documented.has(c)).sort();
  const unused = [...documented].filter((c) => !actual.has(c)).sort();
  const problems = [];
  if (extra.length) problems.push(`代码返回了表上没有的码：${extra.join(',')}`);
  if (unused.length) problems.push(`表里列了但代码从不返回：${unused.join(',')}`);
  return {
    status: problems.length ? 'fail' : 'pass',
    code: problems.length ? 'doc_code_mismatch' : 'ok',
    reason_code: problems.length ? 'doc_code_mismatch' : 'ok',
    message: problems.length ? problems.join('；') : '表与代码一致',
    documented: [...documented].sort(),
    actual: [...actual].sort(),
  };
}

/** 天真做法：相信文档。表说 3，看到实际是 2 也只当实现细节。 */
export function naive() {
  let code = 0;
  try {
    execFileSync(process.execPath, [BIN, 'verify', 'cases/coffee', '--adapter=__nope__'], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  const documented = 3;
  // 文档和实际不一致，但没有人对账，所以「一切正常」。
  return { status: 'pass', observed: code, documented };
}

/** 现在：拿旧表喂校验函数，必须红；拿当前表喂，必须绿。 */
export function caught() {
  const codeText = readFileSync(BIN, 'utf8');
  const legacy = checkDocAgainstCode(LEGACY_DOC, codeText);

  // 反向验证：机制不是见谁都咬。当前表必须过。
  const spec = readFileSync('docs/SPEC.md', 'utf8');
  const start = spec.indexOf('## 8. 退出码');
  const rest = spec.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const current = checkDocAgainstCode(end < 0 ? rest : rest.slice(0, end), codeText);
  if (current.status !== 'pass') {
    throw new Error(`当前第 8 章与代码仍不一致：${current.message}`);
  }
  return legacy;
}

export function run() {
  return { naive: naive(), caught: caught() };
}

// 退出码表必须与代码一致。
//
// SPEC 第 8 章从 v0.7.0 起写「3 = 用法错误」，而 bin/agent-web.mjs 里一处 return 3 都没有，
// 62 处 return 2，--help 印的也是 2。规范与实现不一致了四十多个版本，
// 没有任何测试拦它 —— 因为退出码只在各命令自己的测试里按需断言，没人拿那张表当出处。
//
// 这条测试的用处不是「检查文档有没有写错」，是把「新增一种退出码」变成规范变更：
// 你在代码里 return 一个表上没有的码，这里会红。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BIN = 'bin/agent-web.mjs';
const SPEC = 'docs/SPEC.md';

/** 从 SPEC 第 8 章读出「合法退出码」集合。 */
function specExitCodes() {
  const src = readFileSync(SPEC, 'utf8');
  const start = src.indexOf('## 8. 退出码');
  assert.ok(start >= 0, 'SPEC 里找不到第 8 章');
  const rest = src.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const section = end < 0 ? rest : rest.slice(0, end);
  const codes = new Set();
  for (const line of section.split('\n')) {
    const m = /^\|\s*`?(\d+)`?\s*\|/.exec(line.trim());
    if (m) codes.add(Number(m[1]));
  }
  return codes;
}

/** 从代码里读出所有字面量退出码。 */
function codeExitCodes() {
  const src = readFileSync(BIN, 'utf8');
  const codes = new Set();
  for (const m of src.matchAll(/\breturn\s+(\d+)\s*;/g)) codes.add(Number(m[1]));
  for (const m of src.matchAll(/\bprocess\.exit\((\d+)\)/g)) codes.add(Number(m[1]));
  return codes;
}

test('代码里返回的每一个退出码，第 8 章的表里都得有', () => {
  const spec = specExitCodes();
  const code = codeExitCodes();
  assert.ok(spec.size >= 3, `第 8 章只读出 ${spec.size} 个码，解析八成坏了`);
  const extra = [...code].filter((c) => !spec.has(c)).sort();
  assert.deepEqual(
    extra,
    [],
    `代码返回了表上没有的退出码 ${extra.join(',')} —— 新增退出码是规范变更，先改第 8 章`,
  );
});

test('第 8 章列出的每一个码，代码里都得真的用到', () => {
  const spec = specExitCodes();
  const code = codeExitCodes();
  const unused = [...spec].filter((c) => !code.has(c)).sort();
  assert.deepEqual(
    unused,
    [],
    `第 8 章列了 ${unused.join(',')} 但代码从不返回 —— 文档在描述一个不存在的约定`,
  );
});

test('用法错误的退出码就是 2，帮助文本也这么说', () => {
  const spec = specExitCodes();
  assert.ok(spec.has(2), '第 8 章没有 2');
  assert.ok(!spec.has(3), '第 8 章又把用法错误写成 3 了');

  const help = execFileSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.match(help, /退出码：0 符合预期；1 存在不符；2 用法或环境错误/);

  // 真跑一遍：未知适配器名是用法错误。
  let code = 0;
  try {
    execFileSync(process.execPath, [BIN, 'verify', 'cases/coffee', '--adapter=__nope__'], { stdio: 'pipe' });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 2, '未知适配器名应该退出 2');
});

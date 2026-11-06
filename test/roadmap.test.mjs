import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const roadmap = read('docs/ROADMAP.md');
const limits = read('docs/LIMITS.md');

test('路线图：每一条 P 项都必须带验收命令与「怎么证明它没做到」', () => {
  const blocks = [...roadmap.matchAll(/^## \d+\. (P\d+) — ([^\n]+)$/gm)];
  assert.ok(blocks.length >= 3, `路线图条目太少（${blocks.length}），大概被删薄了`);
  for (const b of blocks) {
    const start = b.index;
    const next = roadmap.indexOf('\n## ', start + 4);
    const body = roadmap.slice(start, next > 0 ? next : roadmap.length);
    assert.ok(/### \d+\.\d+ 验收/.test(body), `${b[1]} 缺「验收」小节`);
    assert.ok(/怎么证明它没做到/.test(body), `${b[1]} 缺「怎么证明它没做到」——没有这一句就不是可证伪的验收`);
  }
});

test('路线图：验收里出现过的命令必须真的存在（标了「待实现」的除外）', () => {
  // 先写验收再写实现是这份文档的写法，所以只检查已经注册的命令。
  const pending = new Set([...roadmap.matchAll(/agent-web ([a-z-]+)[^#]*# 待实现/g)].map((m) => m[1]));
  const cmds = [...roadmap.matchAll(/agent-web ([a-z-]+)/g)].map((m) => m[1]).filter((c) => !pending.has(c));
  const help = read('bin/agent-web.mjs');
  for (const cmd of new Set(cmds)) {
    // 不用正则边界符：补丁脚本里的反斜杠会被 heredoc 吃掉
    const re = new RegExp('([^a-z-]|^)' + cmd + '([^a-z-]|$)');
    assert.ok(re.test(help), `路线图里写的命令 ${cmd} 在 bin/agent-web.mjs 里不存在（还没实现就先写进去了？）`);
  }
});

test('路线图：唯一 open 的那条必须排在第一个', () => {
  const openLimits = [...limits.matchAll(/## (L\d+) ([^\n]+)\n\n`status: open`/g)].map((m) => m[1]);
  if (openLimits.length === 0) return; // 全部降级之后这条自然失效
  const firstP = roadmap.match(/^## \d+\. (P\d+) — ([^\n]+)$/m);
  assert.ok(firstP, '路线图里没有 P 项');
  const body = roadmap.slice(firstP.index, roadmap.indexOf('\n## ', firstP.index + 4));
  const mentioned = openLimits.some((l) => body.includes(l));
  assert.ok(mentioned, `台账里 ${openLimits.join('/')} 还是 open，但路线图第一项没提它`);
});

test('路线图：明确不做的那张表必须包含宪法级的三条', () => {
  for (const word of ['LLM judge', '并发', '打分']) {
    assert.ok(roadmap.includes(word), `「明确不做」里少了「${word}」——这三条是设计声明，不能被后来的人悄悄加回来`);
  }
});

test('路线图：第 0 节的数字必须与实际一致（版本号与变异体数）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(roadmap.includes(`| 版本 | ${pkg.version} |`), `路线图第 0 节的版本号不是 ${pkg.version}`);
  const mutantFiles = fs.readdirSync(path.join(ROOT, 'docs/mutants')).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs' && f !== '_helpers.mjs');
  assert.ok(roadmap.includes(`| 变异体 | ${mutantFiles.length} 个 |`), `路线图写的变异体数不是实测的 ${mutantFiles.length}`);
});

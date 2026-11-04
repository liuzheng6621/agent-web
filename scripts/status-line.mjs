#!/usr/bin/env node
// README 顶上那一行数字，必须是算出来的，不是写上去的。
//
// 起因很实际：有个外部读者（另一个模型）看完仓库，说"这个项目处于 0.1 阶段、7 种断言、
// 暂无发行版"。其中断言种类那条是照着旧 README 的措辞推的。文档一旦靠人跟，就一定会落后，
// 落后的文档会让读者低估整个项目——这个代价比多跑一个脚本高得多。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from '../src/assert/index.mjs';
import { mutants } from '../docs/mutants/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const version = JSON.parse(read('package.json')).version;
const bin = read('bin/agent-web.mjs');
const commands = new Set([...bin.matchAll(/case '([a-z]+)':/g)].map((m) => m[1])).size;

const zh = `当前版本 ${version}</b> · ${KINDS.length} 种断言 · ${commands} 条命令 · ${mutants.length} 个变异体`;
const en = `<b>v${version}</b> · ${KINDS.length} assertion kinds · ${commands} commands · ${mutants.length} mutants`;

const problems = [];
for (const [file, want] of [['README.md', zh], ['README.en.md', en]]) {
  const text = read(file);
  // 允许 "<b>" 在中文版里包住版本号，比较时统一去掉标签
  const flat = text.replace(/<\/?b>/g, '');
  if (!flat.includes(want.replace(/<\/?b>/g, ''))) problems.push({ file, want });
}

// CHANGELOG 第一条必须与 package.json 一致（这条另有测试，这里顺手也查一遍，两处都红更清楚）
const changelog = read('CHANGELOG.md');
const first = changelog.match(/^## ([\d.]+)$/m);
if (!first || first[1] !== version) {
  problems.push({ file: 'CHANGELOG.md', want: `## ${version}（当前第一条是 ${first ? first[1] : '找不到'}）` });
}

if (problems.length === 0) {
  console.log(`状态行一致：${version} / ${KINDS.length} 种断言 / ${commands} 条命令 / ${mutants.length} 个变异体。`);
  process.exit(0);
}

console.error('状态行与代码对不上。把这些行抄进对应文件：');
for (const p of problems) console.error(`  ${p.file}  →  ${p.want}`);
process.exit(1);

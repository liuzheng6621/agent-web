#!/usr/bin/env node
// README 顶上那一行数字，必须是算出来的，不是写上去的。
//
// 起因很实际：有个外部读者（另一个模型）看完仓库，说"这个项目处于 0.1 阶段、7 种断言、
// 暂无发行版"。其中断言种类那条是照着旧 README 的措辞推的。文档一旦靠人跟，就一定会落后，
// 落后的文档会让读者低估整个项目——这个代价比多跑一个脚本高得多。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
const warnings = [];
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

// 第一行 H1 里也带版本号。理由：状态行在文件中部、还包在 <p align="center"> 里，
// 只摘标题、只读前几行、或者把页面当纯文本抓的读者会直接漏掉它——
// "这个项目处于 0.1 阶段"就是这样读出来的。
const h1 = `# agent-web v${version}`;
for (const file of ['README.md', 'README.en.md']) {
  if (!read(file).startsWith(h1)) problems.push({ file, want: `${h1}（必须是文件第一行）` });
}

// VERSION：不读 package.json 的场合（打包、镜像、外部脚本、发给别人的源码快照）也能拿到版本号。
if (!fs.existsSync(path.join(ROOT, 'VERSION')) || read('VERSION').trim() !== version) {
  problems.push({ file: 'VERSION', want: version });
}

// tag 与 package.json 对齐。页面上除 README 外的版本信号只有 tag 和 Release，
// 漂了就会出现"仓库里 0.28、标签还停在 0.18"这种自相矛盾。
// 浅克隆、导出的源码包里可能没有 refs/tags——查不到就跳过，不能因为本地没有版本信息就判红。
// PR 也跳过：fork 会带着自己分叉那一刻的旧 tag，那不是本仓库的错。
const inPullRequest = process.env.GITHUB_EVENT_NAME === 'pull_request';
const tags = inPullRequest ? null : (() => {
  try {
    return execFileSync('git', ['tag', '--list'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((t) => t.trim()).filter(Boolean);
  } catch {
    return null;
  }
})();
// 缺当前版本的 tag 只在发版时算错：正常的顺序是先推 main、CI 绿了再打 tag，
// 这个中间态如果判红，每次发版都会先红一次（真发生过：三次提交连续红在 CI 上）。
// 发版流程用 --require-tag 把它变成硬错。
const requireTag = process.argv.includes('--require-tag');
if (tags && tags.length > 0 && !tags.includes(`v${version}`)) {
  const want = `tag v${version}（当前 tag：${tags.join(' ')}）`;
  if (requireTag) problems.push({ file: '.git', want });
  else warnings.push({ file: '.git', want });
}

for (const w of warnings) console.error(`提醒（不算错）：${w.file} → ${w.want}`);

if (problems.length === 0) {
  console.log(`状态行一致：${version} / ${KINDS.length} 种断言 / ${commands} 条命令 / ${mutants.length} 个变异体。`);
  process.exit(0);
}

console.error('状态行与代码对不上。把这些行抄进对应文件：');
for (const p of problems) console.error(`  ${p.file}  →  ${p.want}`);
process.exit(1);

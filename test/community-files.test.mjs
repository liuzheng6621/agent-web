import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from '../src/assert/index.mjs';
import { mutants } from '../docs/mutants/index.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// 这些文件不是"社区装饰"。它们是这个仓库对外的承诺：
// 什么样的问题算问题、什么样的改动会被合并、什么样的东西算漏洞。
// 少一个，第一个来提 issue 的人就得靠猜。
const REQUIRED = [
  'CONTRIBUTING.md',
  'AGENTS.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CITATION.cff',
  '.editorconfig',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/dependabot.yml',
];

test('社区健康文件一个都不少', () => {
  const missing = REQUIRED.filter((f) => !exists(f));
  assert.deepEqual(missing, [], `缺文件：${missing.join('、')}`);
});

test('三条宪法在 CONTRIBUTING 里都写着 —— 它是唯一对外解释宪法的地方', () => {
  const c = read('CONTRIBUTING.md');
  // 三值判决 + unknown 留分母
  assert.match(c, /pass.*fail.*unknown|`pass`.*`fail`.*`unknown`/);
  assert.match(c, /unknown.*分母|分母.*unknown/);
  // 禁 LLM judge
  assert.match(c, /禁止 LLM judge/);
  // 判据准入
  assert.match(c, /判据准入/);
  assert.match(c, /kind-necessity/);
});

test('CONTRIBUTING 里的六道门必须都是真脚本 —— 写了个不存在的命令比不写更糟', () => {
  const c = read('CONTRIBUTING.md');
  const gates = [
    'scripts/status-line.mjs',
    'scripts/certify-baseline.mjs',
    'scripts/certify-can-fail.mjs',
    'scripts/kind-necessity.mjs',
    'scripts/state-equivalence.mjs',
  ];
  for (const g of gates) {
    assert.ok(c.includes(g), `CONTRIBUTING 没提 ${g}`);
    assert.ok(exists(g), `CONTRIBUTING 提了 ${g}，但文件不存在`);
  }
});

test('AGENTS.md 的五条硬约束与实现一一对应', () => {
  const a = read('AGENTS.md');
  // 约束 3 说的共享实现必须真的存在且被两边引用
  assert.ok(exists('src/step-outcome.mjs'));
  const runner = read('src/runner.mjs');
  const draft = read('src/draft.mjs');
  assert.match(runner, /from '\.\/step-outcome\.mjs'/);
  assert.match(draft, /from '\.\/step-outcome\.mjs'/);
  // 约束 4 说的登记表必须真的存在
  assert.ok(exists('src/reasons.mjs'));
  assert.match(a, /reasons\.mjs/);
  // 约束 5 说的脚本必须真的存在
  assert.match(a, /kind-necessity\.mjs/);
  assert.ok(exists('scripts/kind-necessity.mjs'));
});

test('AGENTS.md 的代码地图数字与仓库实测一致 —— 目录说明写错数字比没写更糟', () => {
  const a = read('AGENTS.md');
  const bin = read('bin/agent-web.mjs');
  const commands = new Set([...bin.matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1])).size;
  const count = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).length;
  const want = [
    [`${commands} 条命令的入口`, '命令数'],
    [`${count('test', /\.test\.mjs$/)} 个测试文件`, '测试文件数'],
    [`${count('scripts', /\.mjs$/)} 个自检脚本`, '自检脚本数'],
    [`${count('docs/museum', /^e\d+.*\.mjs$/)} 件展品`, '博物馆展品数'],
    [`${count('docs/mutants', /^m-.*\.mjs$/)} 个变异体`, '变异体数'],
    [`${KINDS.length} 种断言`, '断言数'],
    [`${(read('docs/LIMITS.md').match(/^## L\d+ /gm) || []).length} 条限制的台账`, '台账条数'],
  ];
  const bad = want.filter(([needle]) => !a.includes(needle)).map(([, label]) => label);
  assert.deepEqual(bad, [], `AGENTS.md 的代码地图数字过期：${bad.join('、')}`);
});

test('AGENTS.md 里提到的源码路径都存在 —— 说明书指错路比没有说明书更糟', () => {
  const a = read('AGENTS.md');
  const paths = [...a.matchAll(/`((?:src|bin|docs|scripts|test|cases)\/[A-Za-z0-9_./-]+)`/g)]
    .map((m) => m[1])
    .filter((p) => !p.endsWith('/'));           // 目录单独判
  const bad = [...new Set(paths)].filter((p) => !exists(p) && !p.includes('<'));
  assert.deepEqual(bad, [], `AGENTS.md 提到了不存在的路径：${bad.join('、')}`);
});

test('SECURITY.md 把「判成 pass 但其实没验过」列为最严重', () => {
  const s = read('SECURITY.md');
  assert.match(s, /判成 `pass` 但其实没验过（最严重）/);
  // 三个历史展品必须点名，否则读的人不知道这是真发生过还是假设
  for (const id of ['07', '08', '11']) {
    assert.ok(s.includes(id), `SECURITY 没提展品 ${id}`);
  }
  // 明确的"不算"边界：这两类已在 LIMITS L8 里，重复报不算新发现
  assert.match(s, /globalThis\.fetch/);
  assert.match(s, /会看探测器的骗子/);
});

test('issue 模板是表单式，且强制要最小复现', () => {
  const bug = read('.github/ISSUE_TEMPLATE/bug_report.yml');
  assert.match(bug, /^name:/m);
  assert.match(bug, /^body:/m);
  // 必填项：版本、复现、期待、实际
  const requiredCount = (bug.match(/required: true/g) || []).length;
  assert.ok(requiredCount >= 4, `必填项只有 ${requiredCount} 个`);
  // 关掉空白 issue：否则表单白做
  assert.match(read('.github/ISSUE_TEMPLATE/config.yml'), /blank_issues_enabled: false/);
});

test('PR 模板强制问「怎么被证伪」', () => {
  const pr = read('.github/PULL_REQUEST_TEMPLATE.md');
  assert.match(pr, /## 怎么被证伪/);
  // 检查清单里的门必须与 CONTRIBUTING 一致
  for (const g of ['status-line.mjs', 'certify-baseline.mjs', 'kind-necessity.mjs', 'state-equivalence.mjs']) {
    assert.ok(pr.includes(g), `PR 模板漏了 ${g}`);
  }
});

test('package.json 有仓库元数据 —— 缺了 npm 页面会显示「无仓库链接」', () => {
  const p = JSON.parse(read('package.json'));
  assert.ok(p.repository, '缺 repository');
  assert.match(p.repository.url, /github\.com\/liuzheng6621\/agent-web/);
  assert.ok(p.bugs?.url, '缺 bugs.url');
  assert.ok(p.homepage, '缺 homepage');
  assert.ok(p.author, '缺 author');
  assert.ok(p.license === 'MIT');
  // 零依赖是卖点，不许被悄悄加回来
  assert.equal(p.dependencies, undefined, '不许有运行时依赖');
});

test('CITATION.cff 的版本与 package.json 一致', () => {
  const cff = read('CITATION.cff');
  const pkg = JSON.parse(read('package.json'));
  const m = cff.match(/^version:\s*(\S+)$/m);
  assert.ok(m, 'CITATION.cff 没有 version 字段');
  assert.equal(m[1], pkg.version, 'CITATION.cff 版本落后于 package.json');
});

test('README 顶部有「该不该用」的判断入口', () => {
  const r = read('README.md');
  const idx = r.indexOf('## 三十秒判断该不该用');
  assert.ok(idx > 0, 'README 缺「三十秒判断该不该用」一节');
  // 必须同时说"不适合什么"——只说不适合的场景才让人敢用
  const section = r.slice(idx, idx + 2000);
  assert.match(section, /帮不上忙/);
  assert.match(section, /不做性能测试/);
});

// 文档地图不许腐烂：docs/README.md 列出的每个仓库内路径都必须真实存在。
test('docs/README.md 文档地图列出的路径都存在', () => {
  const map = read('docs/README.md');
  const links = [...map.matchAll(/\]\(([^)#h][^)#]*?)\)/g)].map((m) => m[1]);
  const missing = [...new Set(links)]
    .map((p) => path.posix.normalize('docs/' + p))
    .filter((p) => !exists(p));
  assert.deepEqual(missing, [], `文档地图指向不存在的路径：${missing.join('、')}`);
});
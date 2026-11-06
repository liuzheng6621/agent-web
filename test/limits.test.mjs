import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 章节标题会改，锚点不改。用 `<!-- limits:start -->` / `<!-- limits:end -->` 切块，
// 这样重写标题不会误伤守卫，删掉整节则一定红。
function readmeItems(lang) {
  const s = read(lang === 'zh' ? 'README.md' : 'README.en.md');
  const start = s.indexOf('<!-- limits:start -->');
  const end = s.indexOf('<!-- limits:end -->');
  assert.ok(start >= 0, (lang === 'zh' ? 'README.md' : 'README.en.md') + ' 缺 limits:start 锚点');
  assert.ok(end > start, (lang === 'zh' ? 'README.md' : 'README.en.md') + ' 缺 limits:end 锚点');
  const block = s.slice(start, end);
  assert.ok(/^## /m.test(block), 'limits 块里必须有二级标题');
  return block.split('\n')
    .filter((l) => /^\d+\.\s/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, ''));
}

function limitsEntries() {
  const s = read('docs/LIMITS.md');
  const ids = [];
  const re = /^## (L\d+) /gm;
  let m;
  while ((m = re.exec(s))) ids.push(m[1]);
  return { raw: s, ids };
}

test('限制清单：README 中英各 11 条，与 docs/LIMITS.md 的条目数一一对应', () => {
  const zh = readmeItems('zh');
  const en = readmeItems('en');
  const { ids } = limitsEntries();
  assert.equal(zh.length, 11, '中文 README 的限制条数变了：' + zh.length);
  assert.equal(en.length, 11, '英文 README 的限制条数变了：' + en.length);
  assert.equal(ids.length, 11, 'LIMITS.md 的条目数变了：' + ids.join(','));
  const want = Array.from({ length: 11 }, (_, i) => 'L' + (i + 1));
  assert.deepEqual(ids, want, 'LIMITS.md 的编号必须是 L1..L11 且按顺序');
});

test('限制清单：每条都必须有 status，且 status 只取五种', () => {
  const { raw, ids } = limitsEntries();
  const ok = new Set(['open', 'mitigated', 'by-design', 'withdrawn', 'ongoing']);
  for (const id of ids) {
    const i = raw.indexOf('## ' + id + ' ');
    const next = raw.indexOf('\n## ', i + 4);
    const block = raw.slice(i, next > 0 ? next : raw.length);
    const m = block.match(/`status:\s*([a-z-]+)`/);
    assert.ok(m, id + ' 缺 status');
    assert.ok(ok.has(m[1]), id + ' 的 status 不在允许集合里：' + m[1]);
  }
});

// 总表和正文各写一次 status，两处会漂：早先 L11 表格写 `continuous`、正文写 `ongoing`，
// 而 `continuous` 根本不在词表里 —— 两处都「看着有」，谁也没发现。
// 守卫要求：表格里每条的 status 必须在五值集合内，且与正文逐字相同。
test('限制清单：总表的 status 与正文逐条一致（两处都写，就会漂）', () => {
  const { raw, ids } = limitsEntries();
  const ok = new Set(['open', 'mitigated', 'by-design', 'withdrawn', 'ongoing']);
  const table = new Map();
  for (const line of raw.split('\n')) {
    const m = line.match(/^\|\s*(L\d+)\s*\|[^|]*\|\s*`([a-z-]+)`\s*\|/);
    if (m) table.set(m[1], m[2]);
  }
  assert.equal(table.size, ids.length, `总表里只有 ${table.size} 行，正文有 ${ids.length} 条：${[...table.keys()]}`);
  for (const id of ids) {
    const want = table.get(id);
    assert.ok(want, `${id} 在总表里缺一行`);
    assert.ok(ok.has(want), `${id} 总表里的 status 不在允许集合里：${want}`);
    const i = raw.indexOf('## ' + id + ' ');
    const next = raw.indexOf('\n## ', i + 4);
    const block = raw.slice(i, next > 0 ? next : raw.length);
    const m = block.match(/`status:\s*([a-z-]+)`/);
    assert.ok(m, id + ' 正文缺 status');
    assert.equal(m[1], want, `${id}：总表写 ${want}，正文写 ${m[1]} —— 两处必须一致`);
  }
});

// 这条守卫查的是「有没有真的提供这个开关」，不是「有没有提到这个词」。
// 早先按裸词匹配，于是注释里写一句「k04 撤回了并发开关」也会判红 ——
// 那是把文档说成代码。现在先把注释剥掉，只在剩下的代码里找开关：
// 字符串字面量里出现 `--jobs`，或者有人读 flags['jobs']。
function codeOnly(src) {
  let out = '';
  let i = 0;
  let state = 'code';
  let quote = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { state = 'string'; quote = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2; } else i += 1;
      continue;
    }
    out += c;
    if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
    if (c === quote) state = 'code';
    i += 1;
  }
  return out;
}

function offersJobsFlag(src) {
  const code = codeOnly(src);
  return code.includes('--jobs') || /flags\s*\[\s*['"]jobs['"]\s*\]/.test(code);
}

test('限制清单：撤回的那条不许再出现在代码里（k04 的教训）', () => {
  const { raw } = limitsEntries();
  assert.ok(/L9[^]*withdrawn/.test(raw), 'L9 应该标 withdrawn');
  const hits = [];
  for (const dir of ['bin', 'src']) {
    const walk = (d) => {
      for (const name of fs.readdirSync(path.join(ROOT, d))) {
        const rel = path.join(d, name);
        const abs = path.join(ROOT, rel);
        if (fs.statSync(abs).isDirectory()) walk(rel);
        else if (rel.endsWith('.mjs') && offersJobsFlag(read(rel))) hits.push(rel);
      }
    };
    walk(dir);
  }
  assert.deepEqual(hits, [], 'L9 说并发已撤回，但代码里又提供了这个开关：' + hits.join(', '));
});

test('限制清单：注释里提到并发开关不算「提供」，字符串字面量才算', () => {
  assert.equal(offersJobsFlag('// k04 撤回了 --jobs，别再加回来'), false);
  assert.equal(offersJobsFlag('/* 不要加 --jobs */\nconst a = 1;'), false);
  assert.equal(offersJobsFlag("flags['jobs'] = 4"), true);
  assert.equal(offersJobsFlag("console.error('用法：--jobs=N')"), true);
  assert.equal(offersJobsFlag('const a = "--jobs";'), true);
  assert.equal(offersJobsFlag("const url = 'https://x/y'; // --jobs 只在这里提过"), false);
});

// 域表格的标题写着「在 N 个域上验过」，N 是手写的数字，表格是手写的行 —— 两处会漂。
// 实测漂过一次：加词库域时把标题改成「four domains」，表格却还是三行，
// 读者看到「四个域」下面只有三条，第一反应是这份文档不可信。
// 守卫要求：标题里的数字 == 表格数据行数 == 中英一致。
const NUM_ZH = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const NUM_EN = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** 取某章节下的表格数据行（去掉表头与分隔行）。 */
function tableRows(text, headingRe) {
  const m = text.match(headingRe);
  if (!m) return null;
  const after = text.slice(m.index + m[0].length);
  const stop = after.search(/\n## /);
  const block = stop >= 0 ? after.slice(0, stop) : after;
  return block.split('\n').filter((l) => l.startsWith('| ') && !/^\|\s*-/.test(l)).slice(1);
}

test('域表格：标题里的域数、表格行数、中英两版必须三者一致', () => {
  const zh = read('README.md');
  const en = read('README.en.md');

  const zhHead = zh.match(/^## 在(.)个域上验过$/m);
  assert.ok(zhHead, '中文 README 找不到「## 在N个域上验过」章节');
  const zhWant = NUM_ZH[zhHead[1]];
  assert.ok(zhWant, `中文标题里的数字认不出来：${zhHead[1]}`);

  const enHead = en.match(/^## Validated across (\w+) domains?$/m);
  assert.ok(enHead, '英文 README 找不到「## Validated across N domains」章节');
  const enWant = NUM_EN[enHead[1].toLowerCase()];
  assert.ok(enWant, `英文标题里的数字认不出来：${enHead[1]}`);

  const zhRows = tableRows(zh, /^## 在.个域上验过$/m);
  const enRows = tableRows(en, /^## Validated across \w+ domains?$/m);
  assert.ok(zhRows && zhRows.length > 0, '中文域表格没有数据行');
  assert.ok(enRows && enRows.length > 0, '英文域表格没有数据行');

  assert.equal(zhRows.length, zhWant, `中文标题写「${zhHead[1]}个域」，表格只有 ${zhRows.length} 行`);
  assert.equal(enRows.length, enWant, `英文标题写「${enHead[1]} domains」，表格只有 ${enRows.length} 行`);
  assert.equal(zhRows.length, enRows.length,
    `中英域表格行数不同：中文 ${zhRows.length} 行、英文 ${enRows.length} 行 —— 加域时两版都要加`);

  // 每个域在中文表里都该指向一份 docs/domains/*.md 或者给出可跑的命令；
  // 这一条不强制（前两个域没有独立文档），但要求表格里的域不是空的。
  for (const row of zhRows) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
    assert.equal(cells.length, 3, `域表格这行不是三列：${row}`);
    assert.ok(cells[0].length > 0 && cells[2].length > 0, `域表格这行有空单元：${row}`);
  }
});

// 这一节分两层：上层列「已经有代码和测试守着」的能力，下层只列「还没解决」的边界。
// 实测漂过：下层有 5 条开头把上层已经说过的事又复述一遍（「align 已给建议」
// 「negatives 已能派生」「步号区间…关联已有」「算法和台账已接通」「判决指纹门已就位」），
// 读者读下来只剩一个疑问：这节到底在说做了还是没做。
// 守卫：下层 11 条里不许再出现完成态措辞 —— 完成的都在上层。
const DONE_ZH = ['已就位', '已接通', '已给建议', '已能', '已有', '已覆盖', '已实现', '已支持', '已提供', '已具备'];
const DONE_EN = ['already', ' is in place', ' gate exists', 'are in place', 'works;'];

function boundaryItems(lang) {
  const text = read(lang === 'zh' ? 'README.md' : 'README.en.md');
  const start = text.search(lang === 'zh' ? /^剩下的边界/m : /^The remaining boundaries/m);
  assert.ok(start >= 0, (lang === 'zh' ? 'README.md' : 'README.en.md') + ' 找不到「剩下的边界」段落');
  const end = text.indexOf('<!-- limits:end -->', start);
  const block = text.slice(start, end);
  return block.split('\n').filter((l) => /^\d+\.\s/.test(l));
}

test('限制清单：下层只写没解决的部分，不许复述上层已经做到的事', () => {
  const zh = boundaryItems('zh');
  const en = boundaryItems('en');
  assert.equal(zh.length, 11, '中文下层的条数变了：' + zh.length);
  assert.equal(en.length, 11, '英文下层的条数变了：' + en.length);

  for (const line of zh) {
    for (const w of DONE_ZH) {
      assert.ok(!line.includes(w),
        `下层这条又说了「${w}」——已经做到的写在上层清单里，这里只写没解决的：\n  ${line}`);
    }
  }
  for (const line of en) {
    const low = line.toLowerCase();
    for (const w of DONE_EN) {
      assert.ok(!low.includes(w),
        `boundary item restates what already works ("${w.trim()}") — that belongs in the upper list:/n  ${line}`);
    }
  }
});

test('限制清单：L5 的口径必须与实测一致（手写数字必然漂）', () => {
  const { raw } = limitsEntries();
  const i = raw.indexOf('## L5 ');
  const next = raw.indexOf('\n## ', i + 4);
  const block = raw.slice(i, next > 0 ? next : raw.length);
  const m = block.match(/当前口径：(\d+) 个变异体，(\d+) 条案例，适用 (\d+)，抓到 (\d+)/);
  assert.ok(m, 'L5 里没有「当前口径」这一行');
  const { execFileSync } = require('node:child_process');
  const measured = execFileSync(process.execPath, ['scripts/certify-baseline.mjs', '--emit-limits'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const mm = measured.match(/当前口径：(\d+) 个变异体，(\d+) 条案例，适用 (\d+)，抓到 (\d+)/);
  assert.ok(mm, '脚本没输出「当前口径」');
  // 只比前四项：第五项是百分比，四舍五入会让 95.05 与 95.1 打架，那不是漂移。
  assert.deepEqual(m.slice(1, 5), mm.slice(1, 5), 'L5 的数字与实测不符：' + measured.trim());
});

test('限制清单：每条给的验收命令都得是真命令', () => {
  const { raw } = limitsEntries();
  const cmds = [...raw.matchAll(/node bin\/agent-web\.mjs ([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(cmds.length >= 8, '验收命令太少，台账大概被删薄了');
  const help = require('node:child_process').execFileSync(process.execPath, ['bin/agent-web.mjs', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  for (const cmd of new Set(cmds)) {
    // 不用正则边界符：补丁脚本里的反斜杠会被 heredoc 吃掉，落盘变成退格字符。
    const re = new RegExp('([^a-z-]|^)' + cmd + '([^a-z-]|$)');
    assert.ok(re.test(help), `台账里的验收命令 ${cmd} 不在 --help 里`);
  }
});

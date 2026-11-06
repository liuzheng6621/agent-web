import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

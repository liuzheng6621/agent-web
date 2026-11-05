import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function readmeItems(lang) {
  const s = read(lang === 'zh' ? 'README.md' : 'README.en.md');
  const i = s.indexOf(lang === 'zh' ? '## 现在做不到什么' : '## What it does not do');
  assert.ok(i >= 0, 'README 缺限制章节');
  const body = s.slice(i);
  const end = body.indexOf('\n## ', 3);
  const block = end > 0 ? body.slice(0, end) : body;
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
        else if (rel.endsWith('.mjs') && read(rel).includes('--jobs')) hits.push(rel);
      }
    };
    walk(dir);
  }
  assert.deepEqual(hits, [], 'L9 说并发已撤回，但代码里又出现了 --jobs：' + hits.join(', '));
});

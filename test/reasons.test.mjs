import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VERDICT_REASONS, ASSERTION_CODES, PROBE_CHECKS, ERROR_CODES, SHARED_CODES,
} from '../src/reasons.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const TABLES = {
  verdict: VERDICT_REASONS,
  assertion: ASSERTION_CODES,
  probe: PROBE_CHECKS,
  error: ERROR_CODES,
};

const RE_MAKE = /makeVerdict\(\s*[^,]+,\s*'[a-z]+',\s*'([a-z_]+)'/g;
const RE_REASON = /reason_code:\s*'([a-z_]+)'/g;
const RE_PROBE_ADD = /add\('([a-z-]+)'/g;
// 折行写法：add( 换行 'observe-stable',
const RE_PROBE_FOLDED = /add\(\s*\n\s*'([a-z-]+)'/g;
// checks.push({ id: 'volatile', ... }) 这种直接塞对象的写法。
const RE_PROBE_PUSH = /id:\s*'([a-z-]+)'/g;
// 前面不能是下划线或字母：否则 reason_code: 'x' 会被当成 code: 'x' 重复计一次。
const RE_CODE = /(?<![_a-zA-Z])code:\s*'([a-z_]+)'/g;
const RE_BAD = /bad\(\s*'([a-z_]+)'/g;
const RE_OK = /ok\(\s*(?:TRUE|FALSE|UNKNOWN)\s*,\s*'([a-z_]+)'/g;
// 三元写法：pass ? 'ok' : 'field_mismatch' —— 假分支就是判假码。
const RE_TERNARY = /\?\s*'ok'\s*:\s*'([a-z_]+)'/g;

/** 源码里所有「产出一个码」的地方，按命名空间归类。 */
function produced() {
  const out = { verdict: new Set(), assertion: new Set(), probe: new Set(), error: new Set() };
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'bin'))]
    .filter((f) => !f.endsWith(path.join('src', 'reasons.mjs')));
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    const base = path.basename(f);
    const isAssert = f.includes(path.sep + 'assert' + path.sep);
    // 判决路径上的几个文件用 `code:` 写「这一步中止在哪」，那些是判决码。
    const isVerdict = ['runner.mjs', 'step-outcome.mjs', 'draft.mjs', 'certify.mjs'].includes(base);
    for (const m of s.matchAll(RE_MAKE)) out.verdict.add(m[1]);
    for (const m of s.matchAll(RE_REASON)) out.verdict.add(m[1]);
    // 只认 src/probe.mjs 里的 add()：别处的 add() 是 Set.add，不是探针项。
    if (base === 'probe.mjs') {
      for (const m of s.matchAll(RE_PROBE_ADD)) out.probe.add(m[1]);
      for (const m of s.matchAll(RE_PROBE_FOLDED)) out.probe.add(m[1]);
      for (const m of s.matchAll(RE_PROBE_PUSH)) out.probe.add(m[1]);
    }
    if (isAssert) {
      for (const m of s.matchAll(RE_CODE)) out.assertion.add(m[1]);
      for (const m of s.matchAll(RE_BAD)) out.assertion.add(m[1]);
      for (const m of s.matchAll(RE_OK)) out.assertion.add(m[1]);
      for (const m of s.matchAll(RE_TERNARY)) out.assertion.add(m[1]);
    } else if (isVerdict) {
      for (const m of s.matchAll(RE_CODE)) out.verdict.add(m[1]);
    } else {
      for (const m of s.matchAll(RE_CODE)) out.error.add(m[1]);
    }
  }
  return out;
}

test('四个命名空间互不重叠（除 SHARED_CODES 里那几个）', () => {
  const seen = new Map();
  for (const [name, table] of Object.entries(TABLES)) {
    for (const k of Object.keys(table)) {
      if (seen.has(k) && !SHARED_CODES.includes(k)) {
        assert.fail(`「${k}」同时出现在 ${seen.get(k)} 与 ${name} 里，除 ${SHARED_CODES.join('/')} 外不该有交集`);
      }
      seen.set(k, name);
    }
  }
});

test('源码里产出的每一个码都登记了', () => {
  const p = produced();
  const missing = [];
  for (const [name, codes] of Object.entries(p)) {
    for (const c of codes) if (!(c in TABLES[name])) missing.push(`${name}:${c}`);
  }
  assert.deepEqual(missing, [], `这些码在源码里产出了但没登记：${missing.join('、')}`);
});

test('登记了却一处都没产出的码要清掉（死码会让人以为它还在生效）', () => {
  const p = produced();
  const dead = [];
  for (const [name, table] of Object.entries(TABLES)) {
    for (const k of Object.keys(table)) {
      if (SHARED_CODES.includes(k) && Object.values(p).some((s) => s.has(k))) continue;
      if (!p[name].has(k)) dead.push(`${name}:${k}`);
    }
  }
  assert.deepEqual(dead, [], `这些码登记了但没有产出点：${dead.join('、')}`);
});

test('判决层的码在 SPEC 第 7 章都提过', () => {
  const spec = fs.readFileSync(path.join(ROOT, 'docs/SPEC.md'), 'utf8');
  const chapter = spec.slice(spec.indexOf('## 7. 判决顺序'), spec.indexOf('## 8. 退出码'));
  // 正文里的「注意 17」也算：unsupported_event 只在那里出现，不在表格行里。
  const mentioned = new Set([...chapter.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
  const missing = Object.keys(VERDICT_REASONS).filter((k) => !mentioned.has(k));
  assert.deepEqual(missing, [], `登记表有但 SPEC 第 7 章没提：${missing.join('、')}`);
});

test('探针层的 id 与 probe 实际跑的项数一致', () => {
  assert.equal(Object.keys(PROBE_CHECKS).length, 18);
  const src = fs.readFileSync(path.join(ROOT, 'src/probe.mjs'), 'utf8');
  const ids = [...src.matchAll(RE_PROBE_ADD)].map((m) => m[1]);
  // 两种写法都要扫：add('x', ...) 单行、折行的 add( 换行 'x'、checks.push({ id: 'x' })。
  for (const m of src.matchAll(/add\(\s*\n\s*'([a-z-]+)'/g)) ids.push(m[1]);
  for (const m of src.matchAll(/id:\s*'([a-z-]+)'/g)) ids.push(m[1]);
  assert.deepEqual([...new Set(ids)].sort(), Object.keys(PROBE_CHECKS).sort());
});

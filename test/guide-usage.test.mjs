import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, PHASE_MATRIX } from '../src/assert/index.mjs';
import { validateCase } from '../src/case.mjs';

const guide = readFileSync(new URL('../docs/GUIDE.md', import.meta.url), 'utf8');

function section(title) {
  const i = guide.indexOf('## ' + title);
  assert.ok(i >= 0, 'GUIDE 缺章节：' + title);
  const rest = guide.slice(i + title.length + 3);
  const j = rest.indexOf('\n## ');
  return j === -1 ? rest : rest.slice(0, j);
}

function tableFirstCol(body) {
  return body.split('\n').filter((l) => l.startsWith('| `')).map((l) => l.split('|')[1].trim().replaceAll('`', ''));
}

test('命令速查表与 bin 的 HELP 命令集一致（33 条互锁）', () => {
  const bin = readFileSync(new URL('../bin/agent-web.mjs', import.meta.url), 'utf8');
  const helpCmds = [...new Set([...bin.matchAll(/agent-web ([a-z0-9-]+)/g)].map((m) => m[1]).filter((c) => !c.startsWith('-')))];
  const rows = tableFirstCol(section('命令速查：三十三条命令各管什么'));
  const docCmds = rows.map((t) => t.split(' ')[0]);
  assert.equal(new Set(docCmds).size, helpCmds.length, '命令速查去重后与 HELP 命令数不一致');
  assert.equal(rows.length, helpCmds.length + 1, '速查表应恰多出两个两级命令行（drill grade / import hurl）相对单级数差 1');
  for (const c of helpCmds) assert.ok(docCmds.includes(c), '速查表缺命令：' + c);
  for (const c of docCmds) assert.ok(helpCmds.includes(c), '速查表多出 HELP 没有的命令：' + c);
});

test('断言速查表的 kind 顺序与相位与 src/assert 的 KINDS/PHASE_MATRIX 一致', () => {
  const rows = tableFirstCol(section('断言速查：二十一种 kind 各判什么'));
  const kinds = rows.map((t) => t.split(' ')[0]);
  assert.deepEqual(kinds, [...KINDS], '断言速查顺序与 KINDS 不一致');
  const phases = section('断言速查：二十一种 kind 各判什么').split('\n').filter((l) => l.startsWith('| `')).map((l) => l.split('|')[3].trim());
  for (let n = 0; n < kinds.length; n++) {
    const k = kinds[n];
    const expect = k === 'composite' ? '随子断言' : PHASE_MATRIX[k].default;
    assert.equal(phases[n], expect, '相位与矩阵不一致：' + k);
  }
});

test('案例写法章的最小案例能过 validateCase', () => {
  const body = section('案例怎么写：一份文件里有什么');
  const m = body.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(m, '案例写法章缺 json 围栏');
  const errors = validateCase(JSON.parse(m[1]));
  assert.deepEqual(errors, [], '最小案例未过校验：' + JSON.stringify(errors));
});

test('引言路由指向四个使用参考章', () => {
  assert.ok(guide.includes('想查命令、字段、断言、适配器怎么写'), '引言缺使用参考路由行');
  assert.ok(guide.includes('## 适配器怎么写：五方法契约'), '缺适配器契约章');
});

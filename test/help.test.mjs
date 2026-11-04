// 帮助文本是门面，也是外部读者（包括别的模型）判断这个仓库有什么的唯一入口。
// 它一旦漏掉几条命令，读者就会得出"这个项目还很早期"的结论——这已经是真发生过的事。
// 所以这里不靠人盯：直接从源码里把「分发的命令」和「帮助里列的命令」抽出来比对。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = fs.readFileSync(path.join(ROOT, 'bin', 'agent-web.mjs'), 'utf8');

function dispatched() {
  const set = new Set();
  for (const m of BIN.matchAll(/case '([a-z]+)':/g)) set.add(m[1]);
  return set;
}

function documented() {
  const start = BIN.indexOf('const HELP = `');
  const end = BIN.indexOf('`;', start);
  const block = BIN.slice(start, end);
  const set = new Set();
  for (const m of block.matchAll(/^\s+agent-web ([a-z]+)/gm)) set.add(m[1]);
  return set;
}

test('帮助里列的命令与代码里分发的命令完全一致', () => {
  const a = [...dispatched()].sort();
  const b = [...documented()].sort();
  const missing = a.filter((x) => !b.includes(x));
  const extra = b.filter((x) => !a.includes(x));
  assert.deepEqual(missing, [], '帮助里少了这些命令：' + missing.join(', '));
  assert.deepEqual(extra, [], '帮助里多了这些并不存在的命令：' + extra.join(', '));
});

test('帮助里的断言种类是从 KINDS 生成的，不是手写清单', async () => {
  const { KINDS } = await import('../src/assert/index.mjs');
  // 只在 HELP 块里找：别的提示语里也有"断言："三个字。
  const start = BIN.indexOf('const HELP = `');
  const block = BIN.slice(start, BIN.indexOf('`;', start));
  const at = block.indexOf('断言：');
  assert.ok(at > 0, 'HELP 里必须有一段说明断言种类');
  const line = block.slice(at, block.indexOf('\n', at));
  assert.ok(line.includes('${KINDS.join('), '断言行必须插值生成，不能手写：' + line);
  assert.ok(KINDS.length >= 12);
});

test('--help 退出码是 0，不带参数才是 2', () => {
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agent-web.mjs'), '--help'], { encoding: 'utf8' });
  const none = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agent-web.mjs')], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.equal(none.status, 2);
});

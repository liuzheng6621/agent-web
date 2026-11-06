import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from '../src/assert/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/**
 * 取「已实现」那一层：从标题到「剩下的边界」之间的块。
 * 这一层的作用是「这些能力已经有了，不该再算成没做」，
 * 所以它一旦漏了某个已经落地的机制，读者就会以为还没做——这正是它出过的事。
 */
function implementedBlock(text, startMark, endMark) {
  const i = text.indexOf(startMark);
  assert.ok(i >= 0, `找不到分界标记：${startMark}`);
  const j = text.indexOf(endMark, i);
  assert.ok(j > i, `找不到分界标记：${endMark}`);
  return text.slice(i, j);
}

// 曾经被写成「缺的能力」、现在已落地的七种。它们必须在清单里被点名——
// 这七种正是读者最容易被旧文档骗的地方。
const ONCE_MISSING = ['window', 'every_step', 'pagination', 'linkage', 'payload', 'timeliness', 'state_machine'];

test('README 边界节：断言总数必须与代码一致，且七种「曾经缺」的必须点名', () => {
  const zh = implementedBlock(read('README.md'), '这一节分两层', '剩下的边界');
  const en = implementedBlock(read('README.en.md'), 'Two layers', 'The remaining boundaries');

  // 总数：不要求把 19 个名字全抄进 README（那是 SPEC 的活），但数字必须对。
  assert.match(zh, new RegExp(`断言 ${KINDS.length} 种`), `中文清单里的断言总数不是 ${KINDS.length}`);
  assert.match(en, new RegExp(`${KINDS.length} assertion kinds`), `英文清单里的断言总数不是 ${KINDS.length}`);

  const missingZh = ONCE_MISSING.filter((k) => !zh.includes(k));
  const missingEn = ONCE_MISSING.filter((k) => !en.includes(k));
  assert.deepEqual(missingZh, [], `中文清单漏了这些曾缺的断言：${missingZh.join(', ')}`);
  assert.deepEqual(missingEn, [], `英文清单漏了这些曾缺的断言：${missingEn.join(', ')}`);
});

test('README 边界节：已实现清单必须点名几个会被人当成「没做」的命令', () => {
  // 这几个都曾经在文档里被写成「缺」或干脆没提，读者据此以为没有。
  const must = ['align', 'crosscheck', 'breed', 'negatives', 'drill grade', 'discover'];
  const zh = implementedBlock(read('README.md'), '这一节分两层', '剩下的边界');
  const en = implementedBlock(read('README.en.md'), 'Two layers', 'The remaining boundaries');
  for (const cmd of must) {
    assert.ok(zh.includes(cmd), `中文「已实现」清单没提 ${cmd}`);
    assert.ok(en.includes(cmd), `英文「已实现」清单没提 ${cmd}`);
  }
});

test('README 边界节：十一条与台账的编号必须一一对应且不重复', () => {
  const zh = implementedBlock(read('README.md'), '剩下的边界', '<!-- limits:end -->');
  const nums = [...zh.matchAll(/^\d+\. /gm)].length;
  assert.equal(nums, 11, `边界节应有 11 条，实际 ${nums} 条`);
  const refs = [...zh.matchAll(/（L(\d+)）/g)].map((m) => Number(m[1]));
  assert.deepEqual(refs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], `L 编号顺序不对：${refs.join(',')}`);
});

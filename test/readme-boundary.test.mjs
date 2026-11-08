import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from '../src/assert/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 台账编号以 docs/LIMITS.md 为唯一基准：README 的条目数跟着它走，
// 不在这里写死字面量（写死就要每加一条改两处测试，改漏一处就假绿）。
function limitsEntries() {
  const ids = [];
  const re = /^## (L\d+) /gm;
  let m;
  const s = read('docs/LIMITS.md');
  while ((m = re.exec(s))) ids.push(m[1]);
  return { ids };
}

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


// v0.67.0：断言表格自身也曾漂移（recurrence 上线两个版本后 README 仍写 17 种、表里没它）。
// 守卫：两份 README 的断言表格必须覆盖 KINDS 的每一个名字——再加断言时，README 不同步就红。
function assertionSection(text, headingMark) {
  const i = text.indexOf(headingMark);
  assert.ok(i >= 0, `找不到断言节标题：${headingMark}`);
  const j = text.indexOf(String.fromCharCode(10) + '## ', i + headingMark.length);
  return text.slice(i, j < 0 ? text.length : j);
}

test('README 断言表格必须覆盖全部 KINDS，数字必须写对', () => {
  const zhSec = assertionSection(read('README.md'), '## 断言能说的');
  const enSec = assertionSection(read('README.en.md'), '## Assertions say more');
  const missingZh = KINDS.filter((k) => !zhSec.includes('`' + k + '`'));
  const missingEn = KINDS.filter((k) => !enSec.includes('`' + k + '`'));
  assert.deepEqual(missingZh, [], `中文断言表漏了：${missingZh.join(', ')}`);
  assert.deepEqual(missingEn, [], `英文断言表漏了：${missingEn.join(', ')}`);
  assert.match(zhSec, new RegExp(KINDS.length + ' 种 kind'));
  assert.match(enSec, new RegExp(KINDS.length + ' kinds'));
});

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

test('README 边界节：条目与台账的编号必须一一对应且不重复', () => {
  const zh = implementedBlock(read('README.md'), '剩下的边界', '<!-- limits:end -->');
  const nums = [...zh.matchAll(/^\d+\. /gm)].length;
  // 条数不写死：真正的约束是「条目数 == 台账条目数」且编号连续。
  const { ids } = limitsEntries();
  assert.equal(nums, ids.length, `边界节应有 ${ids.length} 条，实际 ${nums} 条`);
  const refs = [...zh.matchAll(/（L(\d+)）/g)].map((m) => Number(m[1]));
  assert.deepEqual(refs, ids.map((_, n) => n + 1), `L 编号顺序不对：${refs.join(',')}`);
  const en = implementedBlock(read('README.en.md'), 'The remaining boundaries', '<!-- limits:end -->');
  const enNums = [...en.matchAll(/^\d+\. /gm)].length;
  assert.equal(enNums, ids.length, `英文边界节应有 ${ids.length} 条，实际 ${enNums} 条`);
});

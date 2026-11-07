import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HIGH,
  alignExit,
  alignViews,
  canon,
  formatAlign,
  leaves,
  nameScore,
  normalizeName,
  renderAlignYaml,
  scoreFieldPair,
  profileField,
  toYamlObject,
  valueSignature,
} from '../src/align.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'align');
const readJson = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));

const ref = readJson('ref-view.json');
const renamed = readJson('renamed-view.json');
const hard = readJson('hard-view.json');
const truth = readJson('truth.json');

function mismatches(report, table) {
  const bad = [];
  for (const m of report.mappings) {
    // 下钻字段的键形如 items[].count，真值表里是 count —— 只比裸名，
    // 否则「配对了」会被当成「配错了」。
    if (m.field.includes('[].')) continue;
    const want = Object.prototype.hasOwnProperty.call(table, m.field) ? table[m.field] : m.field;
    if (want === null) bad.push({ field: m.field, mapped: m.target_field, reason: '应当说不清，却给了高置信' });
    else if (want !== m.target_field) bad.push({ field: m.field, mapped: m.target_field, want });
  }
  return bad;
}

test('名字相似度只有四档，不提供连续调参空间', () => {
  assert.equal(nameScore('totalAmount', 'totalAmount'), 1);
  assert.equal(nameScore('total_amount', 'totalAmount'), 1);
  assert.equal(nameScore('total-amount', 'totalamount'), 1);
  assert.equal(nameScore('status', 'state'), 0.8);
  assert.equal(nameScore('orderId', 'ticketKey'), 0.6);
  assert.equal(nameScore('amount', 'zzz'), 0);
  assert.equal(nameScore('by', 'actor'), 0.8, 'by 与 actor 同组');
});

test('复数归一：orders 与 order 是同一件事', () => {
  assert.equal(canon('orders'), 'order');
  assert.equal(canon('tickets'), 'ticket');
  assert.equal(canon('this'), 'this', '短词不剥 s');
  assert.equal(normalizeName('totalAmount'), 'totalamount');
  assert.equal(normalizeName('total_amount'), 'totalamount');
});

test('同义词组分属不同组时不许硬凑', () => {
  // status(state) 与 from(prev) 分属两组，名字再像也不能配
  assert.equal(nameScore('status', 'prev'), 0);
  assert.equal(nameScore('count', 'price'), 0);
});

test('叶子摊平：键名不参与比较，改名不改值集', () => {
  const a = leaves({ items: [{ dishName: '拿铁', count: 2 }, { dishName: '美式', count: 1 }] });
  const b = leaves({ lines: [{ label: '拿铁', qty: 2 }, { label: '美式', qty: 1 }] });
  assert.deepEqual(a, b);
});

test('集合签名：只改键名不变签名，改值就变', async () => {
  const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }];
  const renamedRows = [{ key: 1, title: 'a' }, { key: 2, title: 'b' }];
  const changed = [{ key: 1, title: 'a' }, { key: 3, title: 'b' }];
  const s1 = valueSignature(rows);
  assert.equal(valueSignature(renamedRows), s1);
  assert.notEqual(valueSignature(changed), s1);
});

test('改名夹具：集合全配上、字段恢复 >= 90%、零错配', () => {
  const r = alignViews(ref, renamed, { source: 'ref', target: 'renamed' });
  assert.equal(r.summary.collections, 3);
  assert.equal(r.summary.collections_unresolved, 0);
  assert.ok(r.summary.rate >= 0.9, '字段恢复率 ' + r.summary.rate);
  assert.equal(r.summary.nested_collections, 1, '数组元素里的字段必须下钻');
  assert.equal(r.summary.nested_mapped, 4, 'items 里四个字段全该配上');
  assert.deepEqual(mismatches(r, truth.fields), []);
});

test('行序打乱 + 字段被改名/删掉：宁可说不清，也不许错配', () => {
  const r = alignViews(ref, hard, { source: 'ref', target: 'hard' });
  assert.deepEqual(mismatches(r, truth.hard_fields), []);
  const unresolved = r.unresolved.map((u) => u.field).sort();
  assert.deepEqual(unresolved, ['pickupNo', 'totalAmount'], '字段被删或被改成毫无关系的名字，必须留给人签');
});

test('一对一：一条参照字段最多配一条目标字段，反之亦然', () => {
  const dup = JSON.parse(JSON.stringify(renamed));
  for (const t of dup.tickets) t.ownerCopy = t.owner;
  const r = alignViews(ref, dup, {});
  const refSeen = new Set();
  const tgtSeen = new Set();
  for (const m of r.mappings) {
    const rk = m.collection + '.' + m.field;
    const tk = m.target_collection + '.' + m.target_field;
    assert.ok(!refSeen.has(rk), '参照字段重复映射：' + rk);
    assert.ok(!tgtSeen.has(tk), '目标字段被两条参照抢：' + tk);
    refSeen.add(rk);
    tgtSeen.add(tk);
  }
});

test('高置信必须有独立证据：只有枚举重合不算', () => {
  const rows1 = [{ x: 'A' }, { x: 'B' }, { x: 'A' }];
  const rows2 = [{ yy: 'A' }, { yy: 'B' }, { yy: 'A' }];
  const p1 = profileField(rows1, 'x');
  const p2 = profileField(rows2, 'yy');
  const s = scoreFieldPair(p1, p2, {});
  assert.equal(s.confident, false, '名字无关时不能仅凭枚举重合给高置信');
  assert.ok(s.score < HIGH);
});

test('类型不同直接出局，不给半分', () => {
  const a = profileField([{ n: 1 }, { n: 2 }], 'n');
  const b = profileField([{ n: 'one' }, { n: 'two' }], 'n');
  const s = scoreFieldPair(a, b, {});
  assert.equal(s.score, 0);
  assert.equal(s.gate, 'type');
});

test('空输入不炸：没有集合就没有比例', () => {
  const r = alignViews({}, {}, {});
  assert.equal(r.summary.collections, 0);
  assert.equal(r.summary.rate, null);
  assert.ok(formatAlign(r).includes('一个集合都没配上'));
});

test('align.yml：未定进 unresolved，accepted 是空的（人签之前不生效）', () => {
  const r = alignViews(ref, hard, { source: 'a.json', target: 'b.json' });
  const yml = renderAlignYaml(r);
  assert.ok(yml.includes('accepted: []'));
  assert.ok(yml.includes('unresolved:'));
  // 原先是 `yml.includes('targetAmount') === false || true`，永远通过。
  // 想说的是「未定的映射不许进 accepted」，那就直接查 accepted 段。
  assert.ok(!yml.split('accepted:')[1].includes('targetAmount'), '未定映射混进了 accepted');
  const obj = toYamlObject(r);
  assert.equal(obj.align_version, 'agent-web/align-1');
  assert.ok(obj.unresolved.some((u) => u.field === 'pickupNo'));
});

test('退出码：默认不管未定；--require-all 与 --max-unresolved 才拦', () => {
  const good = alignViews(ref, renamed, {});
  const bad = alignViews(ref, hard, {});
  assert.equal(alignExit(good, {}), 0);
  assert.equal(alignExit(bad, {}), 0);
  assert.equal(alignExit(good, { requireAll: true }), 0);
  assert.equal(alignExit(bad, { requireAll: true }), 1);
  assert.equal(alignExit(bad, { maxUnresolved: 1 }), 1);
  assert.equal(alignExit(bad, { maxUnresolved: 2 }), 0);
});

const ambRef = JSON.parse(fs.readFileSync(path.join(FIX, 'amb-ref.json'), 'utf8'));
const ambTgt = JSON.parse(fs.readFileSync(path.join(FIX, 'amb-tgt.json'), 'utf8'));

test('下钻：容器配上了，元素里的字段也要配（items → lines）', () => {
  const r = alignViews(ref, renamed, {});
  const nested = r.mappings.filter((m) => m.field.includes('[].'));
  assert.equal(r.summary.nested_collections, 1, '数组字段必须被下钻一次');
  assert.equal(nested.length, 4, 'items 里四个字段全该配上');
  const byName = new Map(nested.map((m) => [m.field, m.target_field]));
  assert.equal(byName.get('items[].count'), 'lines[].qty');
  assert.equal(byName.get('items[].unitPrice'), 'lines[].unitRate');
  assert.equal(byName.get('items[].subTotal'), 'lines[].lineSum');
  assert.equal(byName.get('items[].dishName'), 'lines[].label');
});

test('下钻：两侧前缀各自用自己的容器名，不共用参照的名字', () => {
  const r = alignViews(ref, renamed, {});
  for (const m of r.mappings.filter((x) => x.field.includes('[].'))) {
    assert.ok(m.field.startsWith('items[].'), '源侧前缀错了：' + m.field);
    assert.ok(m.target_field.startsWith('lines[].'), '目标侧前缀错了：' + m.target_field);
  }
});

test('歧义：两个源字段都自信地指向同一个目标字段 → 一个都不配，全留给人签', () => {
  const r = alignViews(ambRef, ambTgt, {});
  const amb = r.ambiguous.map((a) => a.path).sort();
  assert.deepEqual(amb, ['count', 'quantity'], 'count 与 quantity 都指向 qty，必须判歧义');
  const mapped = r.mappings.map((m) => m.field);
  assert.ok(!mapped.includes('count'), '有歧义时不许擅自配 count');
  assert.ok(!mapped.includes('quantity'), '有歧义时不许擅自配 quantity');
  for (const a of r.ambiguous) {
    assert.equal(a.target_path, 'qty');
    assert.ok(a.rivals.length >= 1, '必须写明竞争对手是谁');
  }
});

test('歧义：只有一个源字段时照常配上（别把正常情况也拦下来）', () => {
  const r = alignViews(ref, renamed, {});
  assert.equal(r.ambiguous.length, 0, '正常夹具不该有歧义');
});

test('取值完全一致且唯一 → 采纳；但纯数字不算身份证据', () => {
  const r = alignViews(ref, renamed, {});
  const dish = r.mappings.find((m) => m.field === 'items[].dishName');
  assert.ok(dish, 'dishName → label 取值一模一样且唯一，该采纳');
  assert.equal(dish.target_field, 'lines[].label');
  // 数字撞车常见：hard 夹具里 totalAmount 不该因为「值像」被配成 x9
  const hard = alignViews(ref, JSON.parse(fs.readFileSync(path.join(FIX, 'hard-view.json'), 'utf8')), {});
  assert.ok(!hard.mappings.some((m) => m.field === 'totalAmount'), '数字取值一致不构成身份证据');
});

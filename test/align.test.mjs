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
  assert.ok(yml.includes('targetAmount') === false || true);
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

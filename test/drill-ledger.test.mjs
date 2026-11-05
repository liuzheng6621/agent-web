import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LEDGER_VERSION,
  MIN_ATTEMPTS,
  appendLedger,
  computeStats,
  difficultyBand,
  fingerprintRows,
  formatStats,
  parseItemId,
  readLedger,
  statsExit,
  toRecord,
  wilson,
} from '../src/drill-ledger.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ledger-'));

function fakeReport(rows) {
  return { drill_version: 'agent-web/drill-1', rows: rows };
}

function row(id, status, cells) {
  return { id: id, status: status, cells: cells || ['killed'], killed: 1 };
}

test('题号解析：case@mutant', () => {
  const p = parseItemId('coffee/cancel-before-pickup@m-money-off-by-cent');
  assert.equal(p.testCase, 'coffee/cancel-before-pickup');
  assert.equal(p.mutant, 'm-money-off-by-cent');
  assert.equal(p.malformed, false);
  assert.equal(parseItemId('no-at-sign').malformed, true);
});

test('入账行只留机制能证明的东西：不带 detail、不带断言', () => {
  const rec = toRecord(
    fakeReport([
      { id: 'a/b@m-x', status: 'solved', cells: ['killed', 'survived'], killed: 1, detail: '这句不许进台账' },
      { id: 'a/c@m-y', status: 'missed', cells: ['survived'], killed: 0 },
    ]),
    { at: '2026-11-05T00:00:00.000Z' },
  );
  assert.equal(rec.ledger_version, LEDGER_VERSION);
  assert.equal(rec.rows.length, 2);
  assert.equal(rec.summary.solved, 1);
  assert.equal(rec.summary.missed, 1);
  const text = JSON.stringify(rec);
  assert.ok(!text.includes('这句不许进台账'), 'detail 不许进台账');
  assert.ok(!text.includes('assert'), '断言内容不许进台账');
  assert.deepEqual(rec.rows[0].cells, ['killed', 'survived']);
});

test('提交指纹来自批改形状，同形状同指纹、不同形状不同指纹', () => {
  const a = fingerprintRows(fakeReport([row('a@m1', 'solved')]));
  const b = fingerprintRows(fakeReport([row('a@m1', 'solved')]));
  const c = fingerprintRows(fakeReport([row('a@m1', 'missed')]));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^sha256:[0-9a-f]{16}$/);
});

test('台账只追加：两次批改写出两行，读回两条', async () => {
  const file = path.join(TMP, 'sub', 'ledger.jsonl');
  const r1 = toRecord(fakeReport([row('a@m1', 'solved')]));
  const r2 = toRecord(fakeReport([row('a@m1', 'missed')]));
  await appendLedger(file, r1);
  await appendLedger(file, r2);
  const { records } = await readLedger(file);
  assert.equal(records.length, 2);
  assert.equal(records[0].rows[0].status, 'solved');
  assert.equal(records[1].rows[0].status, 'missed');
});

test('台账容错：读不懂的行跳过并计数，版本不符也算读不懂', async () => {
  const file = path.join(TMP, 'bad.jsonl');
  const good = JSON.stringify(toRecord(fakeReport([row('a@m1', 'solved')])));
  fs.writeFileSync(file, good + '\n{ not json\n' + JSON.stringify({ ledger_version: 'other-1', rows: [] }) + '\n', 'utf8');
  const r = await readLedger(file);
  assert.equal(r.records.length, 1);
  assert.equal(r.bad_lines, 2);
});

test('台账缺失不是错误，是不存在', async () => {
  const r = await readLedger(path.join(TMP, 'nope.jsonl'));
  assert.equal(r.missing, true);
  assert.deepEqual(r.records, []);
});

test('Wilson 区间：全对也不许写 100%，样本少时区间必须宽', () => {
  const all = wilson(11, 11);
  assert.equal(all.point, 1);
  assert.ok(all.low < 0.8 && all.low > 0.7, '11/11 的下界应在 74% 附近，实际 ' + all.low);
  assert.equal(all.high, 1);
  const small = wilson(2, 2);
  assert.ok(small.high - small.low > all.high - all.low, '样本越小区间越宽');
  assert.deepEqual(wilson(0, 0), { point: null, low: null, high: null });
});

test('统计：样本不足不给百分比结论，够 MIN_ATTEMPTS 才分层', () => {
  const recs = [];
  for (let i = 0; i < MIN_ATTEMPTS - 1; i += 1) recs.push(toRecord(fakeReport([row('a@m1', 'solved')])));
  const thin = computeStats(recs);
  assert.equal(thin.items[0].band, 'insufficient_data');
  assert.equal(thin.bands.insufficient_data, 1);
  assert.equal(thin.measured, 0);

  recs.push(toRecord(fakeReport([row('a@m1', 'solved')])));
  const thick = computeStats(recs);
  assert.equal(thick.items[0].attempts, MIN_ATTEMPTS);
  assert.equal(thick.items[0].band, 'easy');
  assert.equal(thick.measured, 1);
});

test('统计：分层边界 easy / medium / hard', () => {
  assert.equal(difficultyBand(10, 0.8), 'easy');
  assert.equal(difficultyBand(10, 0.79), 'medium');
  assert.equal(difficultyBand(10, 0.4), 'medium');
  assert.equal(difficultyBand(10, 0.39), 'hard');
  assert.equal(difficultyBand(4, 0.0), 'insufficient_data');
  assert.equal(difficultyBand(10, null), 'insufficient_data');
});

test('统计：默认只算能批改的批次，未作答不进分母', () => {
  const recs = [
    toRecord(fakeReport([row('a@m1', 'solved'), row('a@m2', 'unanswered')])),
    toRecord(fakeReport([row('a@m1', 'missed')])),
  ];
  const s = computeStats(recs);
  const m1 = s.items.find((x) => x.item === 'a@m1');
  assert.equal(m1.attempts, 2);
  assert.equal(m1.solved, 1);
  const m2 = s.items.find((x) => x.item === 'a@m2');
  assert.equal(m2, undefined, '未作答默认不进统计');

  const withUngraded = computeStats(recs, { includeUngraded: true });
  const m2b = withUngraded.items.find((x) => x.item === 'a@m2');
  assert.equal(m2b.ungraded, 1);
  assert.equal(m2b.attempts, 0);
  assert.equal(m2b.band, 'insufficient_data');
});

test('统计：难的题排前面，没测过的排后面', () => {
  const recs = [];
  for (let i = 0; i < MIN_ATTEMPTS; i += 1) {
    recs.push(toRecord(fakeReport([
      row('c/easy@m1', 'solved'),
      row('c/hard@m2', 'missed'),
      row('c/mid@m3', i % 2 === 0 ? 'solved' : 'missed'),
    ])));
  }
  const s = computeStats(recs);
  assert.equal(s.items[0].item, 'c/hard@m2');
  assert.equal(s.items[0].band, 'hard');
  assert.equal(s.items[s.items.length - 1].item, 'c/easy@m1');
});

test('统计：输出里必须有区间，样本不足要说清楚', () => {
  const s = computeStats([toRecord(fakeReport([row('a@m1', 'solved')]))]);
  const text = formatStats(s);
  assert.ok(text.includes('100.0%'));
  assert.ok(text.includes('样本不足'), '样本不足必须写在输出里');
  assert.ok(text.includes('区间') || text.includes('['), '必须给区间');
  assert.ok(!text.includes('容易 1'), '样本不足的题不许被分进容易');
});

test('退出码：没给 --min-attempts 永远是 0；给了就按总尝试数判', () => {
  const thin = computeStats([toRecord(fakeReport([row('a@m1', 'solved')]))]);
  assert.equal(statsExit(thin, {}), 0);
  assert.equal(statsExit(thin, { minAttempts: 5 }), 1);
  assert.equal(statsExit(thin, { minAttempts: 1 }), 0);
});

test('出题排序用的名次表：难的在前，没测过的不在表里', async () => {
  const { rankItems } = await import('../src/drill-ledger.mjs');
  const recs = [];
  for (let i = 0; i < MIN_ATTEMPTS; i += 1) {
    recs.push(toRecord(fakeReport([row('c/hard@m1', 'missed'), row('c/easy@m2', 'solved')])));
  }
  const s = computeStats(recs);
  const rank = rankItems(s);
  assert.equal(rank.get('c/hard@m1'), 0);
  assert.equal(rank.get('c/easy@m2'), 1);
  assert.equal(rank.get('c/never@m3'), undefined, '没测过的题不该出现在名次表里');
});

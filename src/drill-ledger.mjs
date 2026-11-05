// 出题台账：把「这次答了几题」变成「跨批次可比」。
//
// 一条记录只存机制能证明的东西：题号、状态、每个断言的判定格、提交的哈希。
// 不存提交内容 —— 台账是用来算难度的，不是用来收集答案的。

import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { stableStringify } from './values.mjs';

export const LEDGER_VERSION = 'agent-web/drill-ledger-1';
export const STATS_VERSION = 'agent-web/drill-stats-1';

/** 题号固定是 `case@mutant`，解析出来给台账分组。 */
export function parseItemId(id) {
  const s = String(id);
  const at = s.lastIndexOf('@');
  if (at <= 0) return { testCase: null, mutant: null, malformed: true };
  return { testCase: s.slice(0, at), mutant: s.slice(at + 1), malformed: false };
}

/**
 * 提交指纹：对「批改结果的形状」取哈希，而不是对提交内容取哈希。
 * 这样台账能认出同一份提交重复跑，又不存任何一行答案。
 */
export function fingerprintRows(report) {
  const rows = (report.rows || []).map(function (r) {
    return { id: r.id, status: r.status, cells: r.cells || null };
  });
  const h = createHash('sha256').update(stableStringify(rows)).digest('hex');
  return 'sha256:' + h.slice(0, 16);
}

/** 从一次批改报告里抽出可入账的行。刻意不抄 detail（里面可能带被提交的断言）。 */
export function toRecord(report, opts) {
  const o = opts || {};
  const rows = (report.rows || []).map(function (r) {
    const parsed = parseItemId(r.id);
    return {
      item: r.id,
      test_case: parsed.testCase,
      mutant: parsed.mutant,
      status: r.status,
      cells: Array.isArray(r.cells) ? r.cells.slice() : null,
      killed: typeof r.killed === 'number' ? r.killed : null,
    };
  });
  return {
    ledger_version: LEDGER_VERSION,
    drill_version: report.drill_version || null,
    recorded_at: o.at || new Date().toISOString(),
    submission: o.submission || fingerprintRows(report),
    summary: {
      items: rows.length,
      solved: rows.filter(function (r) { return r.status === 'solved'; }).length,
      missed: rows.filter(function (r) { return r.status === 'missed'; }).length,
      ungraded: rows.filter(function (r) {
        return r.status !== 'solved' && r.status !== 'missed';
      }).length,
    },
    rows: rows,
  };
}

/** 追加一行 JSONL。台账是只追加的：任何一次批改都不该改写历史。 */
export async function appendLedger(file, record) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await appendFile(file, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

export async function readLedger(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { records: [], bad_lines: 0, missing: true };
    throw e;
  }
  const records = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      const rec = JSON.parse(t);
      if (rec && rec.ledger_version === LEDGER_VERSION) records.push(rec);
      else bad += 1;
    } catch {
      bad += 1;
    }
  }
  return { records: records, bad_lines: bad, missing: false };
}

/** Wilson 区间：小样本下也不该出现 [0,1] 以外的胡说。 */
export function wilson(successes, n, z) {
  const zz = z === undefined ? 1.96 : z;
  if (!Number.isFinite(successes) || !Number.isFinite(n) || n <= 0) {
    return { point: null, low: null, high: null };
  }
  const p = successes / n;
  const z2 = zz * zz;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (zz * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    point: p,
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

export const MIN_ATTEMPTS = 5;

/** 难度分层：样本不够就明说不够，不给一个看起来像结论的百分比。 */
export function difficultyBand(n, rate) {
  if (n < MIN_ATTEMPTS || rate === null) return 'insufficient_data';
  if (rate >= 0.8) return 'easy';
  if (rate >= 0.4) return 'medium';
  return 'hard';
}

/** 把台账折成统计：按题聚合，跨批次可比。 */
export function computeStats(records, opts) {
  const o = opts || {};
  const onlyGraded = o.includeUngraded !== true;
  const byItem = new Map();
  let batches = 0;
  const submissions = new Set();
  for (const rec of records) {
    batches += 1;
    if (rec.submission) submissions.add(rec.submission);
    for (const row of rec.rows || []) {
      const status = row.status;
      const graded = status === 'solved' || status === 'missed';
      if (!graded && onlyGraded) continue;
      let cell = byItem.get(row.item);
      if (!cell) {
        cell = {
          item: row.item,
          test_case: row.test_case,
          mutant: row.mutant,
          attempts: 0,
          solved: 0,
          missed: 0,
          ungraded: 0,
          cells: {},
        };
        byItem.set(row.item, cell);
      }
      if (graded) {
        cell.attempts += 1;
        if (status === 'solved') cell.solved += 1;
        else cell.missed += 1;
      } else {
        cell.ungraded += 1;
      }
      for (const c of row.cells || []) {
        cell.cells[c] = (cell.cells[c] || 0) + 1;
      }
    }
  }
  const items = [];
  for (const cell of byItem.values()) {
    const ci = wilson(cell.solved, cell.attempts);
    items.push({
      item: cell.item,
      test_case: cell.test_case,
      mutant: cell.mutant,
      attempts: cell.attempts,
      solved: cell.solved,
      missed: cell.missed,
      ungraded: cell.ungraded,
      rate: ci.point,
      ci95: { low: ci.low, high: ci.high },
      band: difficultyBand(cell.attempts, ci.point),
      cells: cell.cells,
    });
  }
  items.sort(function (a, b) {
    if (a.attempts === 0 && b.attempts > 0) return 1;
    if (b.attempts === 0 && a.attempts > 0) return -1;
    const ra = a.rate === null ? 1 : a.rate;
    const rb = b.rate === null ? 1 : b.rate;
    if (ra !== rb) return ra - rb; // 难的排前面
    return String(a.item).localeCompare(String(b.item));
  });
  const measured = items.filter(function (x) { return x.band !== 'insufficient_data'; });
  const totalAttempts = items.reduce(function (a, x) { return a + x.attempts; }, 0);
  const totalSolved = items.reduce(function (a, x) { return a + x.solved; }, 0);
  const overall = wilson(totalSolved, totalAttempts);
  return {
    stats_version: STATS_VERSION,
    batches: batches,
    submissions: submissions.size,
    items: items,
    measured: measured.length,
    unmeasured: items.length - measured.length,
    totals: {
      attempts: totalAttempts,
      solved: totalSolved,
      rate: overall.point,
      ci95: { low: overall.low, high: overall.high },
    },
    bands: {
      easy: items.filter(function (x) { return x.band === 'easy'; }).length,
      medium: items.filter(function (x) { return x.band === 'medium'; }).length,
      hard: items.filter(function (x) { return x.band === 'hard'; }).length,
      insufficient_data: items.filter(function (x) { return x.band === 'insufficient_data'; }).length,
    },
  };
}

function pct(x) {
  return x === null || x === undefined ? '—' : (x * 100).toFixed(1) + '%';
}

export function formatStats(stats, opts) {
  const detail = Boolean(opts && opts.detail);
  const out = [];
  out.push('出题台账 · ' + stats.batches + ' 次批改 · ' + stats.submissions + ' 份提交 · ' + stats.items.length + ' 道题');
  out.push('');
  out.push(
    '  总解出率 ' + stats.totals.solved + ' / ' + stats.totals.attempts + '   → ' + pct(stats.totals.rate) +
      (stats.totals.rate === null
        ? ''
        : '   95% 区间 [' + pct(stats.totals.ci95.low) + ', ' + pct(stats.totals.ci95.high) + ']'),
  );
  out.push(
    '  难度分层：容易 ' + stats.bands.easy + ' · 中等 ' + stats.bands.medium + ' · 困难 ' + stats.bands.hard +
      ' · 样本不足 ' + stats.bands.insufficient_data + '（每题至少 ' + MIN_ATTEMPTS + ' 次才算数）',
  );
  const show = detail ? stats.items : stats.items.filter(function (x) { return x.band !== 'insufficient_data'; });
  if (show.length > 0) {
    out.push('');
    for (const x of show) {
      const ci = x.ci95.low === null ? '—' : '[' + pct(x.ci95.low) + ', ' + pct(x.ci95.high) + ']';
      out.push(
        '  ' + x.band.padEnd(17) + ' ' + pct(x.rate).padStart(6) + ' ' + ci.padEnd(16) +
          ' n=' + x.attempts + '  ' + x.item,
      );
    }
  }
  if (stats.unmeasured > 0 && !detail) {
    out.push('');
    out.push('  另有 ' + stats.unmeasured + ' 道题样本不足（< ' + MIN_ATTEMPTS + ' 次），不计入分层；--detail 可看全部。');
  }
  return out.join('\n');
}

/** 榜上无名 = 没被测过，排在难度最高的后面；其次是解出率最低的。 */
export function rankItems(stats) {
  const rank = new Map();
  (stats.items || []).forEach(function (x, i) { rank.set(x.item, i); });
  return rank;
}

export function statsExit(stats, opts) {
  const minAttempts = opts && typeof opts.minAttempts === 'number' ? opts.minAttempts : null;
  if (minAttempts === null) return 0;
  return stats.totals.attempts >= minAttempts ? 0 : 1;
}

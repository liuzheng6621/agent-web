/**
 * 指标层。
 *
 * 三条口径是硬规矩：
 *   1) unknown 留在分母里。可判定率 = (P+F)/N，不是 (P+F)/(P+F)。
 *   2) 所有比例同时报原始计数；零分母记 NA，不记 0。
 *   3) 小样本零错误不能宣称错误率为零 —— 给 Wilson 区间。
 *
 * 最后一条最容易犯：7 条案例全对，不等于判定器准。
 */

import { TRUE } from './three-valued.mjs';

export function wilson(successes, n, z = 1.96) {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function ratio(num, den) {
  if (den === 0) {
    return { value: null, numerator: num, denominator: den, ci95: null };
  }
  return { value: num / den, numerator: num, denominator: den, ci95: wilson(num, den) };
}

const round = (x) => (x === null ? null : Math.round(x * 10000) / 10000);

export function summarize(verdicts) {
  const N = verdicts.length;
  const P = verdicts.filter((v) => v.status === 'pass').length;
  const F = verdicts.filter((v) => v.status === 'fail').length;
  const U = verdicts.filter((v) => v.status === 'unknown').length;

  const byReason = {};
  for (const v of verdicts) {
    const k = `${v.status}/${v.reason_code}`;
    byReason[k] = (byReason[k] ?? 0) + 1;
  }

  const byAdapter = {};
  for (const v of verdicts) {
    byAdapter[v.adapter] = (byAdapter[v.adapter] ?? 0) + 1;
  }

  const complex = verdicts.filter((v) => v.labels?.complex).length;

  const timings = verdicts.map((v) => v.timing_ms).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const pct = (p) => {
    if (timings.length === 0) return null;
    const idx = Math.min(timings.length - 1, Math.max(0, Math.ceil((p / 100) * timings.length) - 1));
    return timings[idx];
  };

  return {
    total: N,
    pass: P,
    fail: F,
    unknown: U,
    decidable_rate: ratio(P + F, N),
    pass_yield: ratio(P, N),
    unknown_rate: ratio(U, N),
    complex_ratio: ratio(complex, N),
    by_reason: byReason,
    by_adapter: byAdapter,
    timing_ms: {
      p50: pct(50),
      p95: pct(95),
      max: timings.length ? timings[timings.length - 1] : null,
    },
    rounding: '四位小数',
  };
}

/**
 * 一致性：案例自带 expect.status 时，判决器与预期的一致率。
 * 这是自测用的代理指标，不是 false-pass rate —— 真正的 false-pass 需要独立 oracle。
 */
export function agreement(verdicts, expected) {
  const checked = verdicts.filter((v) => expected[v.case_id] !== undefined);
  const hit = checked.filter((v) => expected[v.case_id] === v.status).length;
  const confusion = {};
  for (const v of checked) {
    const k = `expect=${expected[v.case_id]} got=${v.status}`;
    confusion[k] = (confusion[k] ?? 0) + 1;
  }
  return {
    checked: checked.length,
    agree: hit,
    rate: ratio(hit, checked.length),
    confusion,
    note: '这是自测代理指标，不等于 false-pass rate：预期标签由人写，独立 oracle 另说',
  };
}

export function formatText(summary, extra = {}) {
  const pctText = (r) =>
    r.value === null
      ? 'NA'
      : `${(r.value * 100).toFixed(1)}% (${r.numerator}/${r.denominator})` +
        (r.ci95 ? ` CI95[${(r.ci95.low * 100).toFixed(0)}%, ${(r.ci95.high * 100).toFixed(0)}%]` : '');

  const lines = [];
  lines.push(`样本 N=${summary.total}  pass=${summary.pass} fail=${summary.fail} unknown=${summary.unknown}`);
  lines.push('');
  lines.push(`可判定率   ${pctText(summary.decidable_rate)}`);
  lines.push(`通过产出率 ${pctText(summary.pass_yield)}`);
  lines.push(`未知占比   ${pctText(summary.unknown_rate)}`);
  lines.push(`复杂候选   ${pctText(summary.complex_ratio)}`);
  lines.push(`耗时       p50=${summary.timing_ms.p50 ?? 'NA'}ms p95=${summary.timing_ms.p95 ?? 'NA'}ms`);
  lines.push('');
  lines.push('按原因：');
  for (const [k, v] of Object.entries(summary.by_reason).sort()) lines.push(`  ${k.padEnd(34)} ${v}`);
  if (extra.agreement) {
    lines.push('');
    lines.push(`与预期标签一致 ${(extra.agreement.rate.value * 100).toFixed(1)}% (${extra.agreement.agree}/${extra.agreement.checked})`);
    for (const [k, v] of Object.entries(extra.agreement.confusion).sort()) lines.push(`  ${k.padEnd(34)} ${v}`);
    lines.push(`  注：${extra.agreement.note}`);
  }
  return lines.join('\n');
}

export function countFailedAssertions(verdicts) {
  const counts = {};
  for (const v of verdicts) {
    for (const a of v.failed_assertions ?? []) {
      const k = `${a.kind}/${a.code}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  return counts;
}

export { round };

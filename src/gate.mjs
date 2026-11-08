// gate —— 三层验证栈的「四行口径」一次出齐，缺任一行就红。
//
// 设计文档（TRI_LAYER_VERIFICATION.md 第 5 节）给 report 定了四行：
//   1 契约覆盖率     有机器判据的已声明不变量 / 全部已声明不变量
//   2 判据抗变异率   被变异体击穿的判据 / 已运行的判据变异
//   3 独立证据判决率 有通道 B 或 conftest 佐证的判决 / 全部判决
//   4 unknown 占比   unknown / 全部判决（留在分母，显式可见）
//
// 这四行以前散在 capabilities / certify / compare / report 四个命令里，
// 而且第 3 行根本没机器落点（compare 只对两两适配器，不回填进一份口径）。
// gate 把它们编排成一次输出：行缺（没跑 certify、没跑 compare、判决为零）
// = missing = exit 1。行值低不红——gate 是口径门禁，不是质量门禁。
//
// 但「行在」不等于「行有证据」（v0.75.0 外部测评发现 1）：第二通道整列
// unknown 时 agree/total 退化成幸存者比率，行照样绿。因此第 3 行自带
// 可比分母：comparable = 两侧判决都不是 unknown 的对数。可比为 0 = 无
// 独立证据 = 该行视同缺行（missing）。--min-comparable=N 再给一条可调
// 下限：可比 < N 记入 violations（exit 1），默认 0 不设限——下限是策略，
// 口径是事实，两者分开。
//
// 名字：设计文档里叫 audit，但 audit 这个名字在本仓已被混淆矩阵工具
// （src/audit.mjs，可信判决量被审判决）占用且语义已发布。门禁语义
// 正好叫 gate，docstring 在此留一笔对应关系。
//
// 禁语（与 report --counts 同规）：输出里不出现 score/grade/rank，
// 不出现无分母的百分比——四行全部是 m/n (x.x%) 形式。

export const GATE_VERSION = 'agent-web/gate-1';

/**
 * @param {object} args
 * @param {object|null} args.coverage  summarizeCoverage 的产物（rate.value/covered/declared）
 * @param {{summary:object}|null} args.certify certify() 的 report（用 summary）
 * @param {Array<{status:string}>} args.verdicts verify 的判决数组
 * @param {{agree:number,total:number,left:string,right:string}|null} args.compare 两通道对照
 * @param {{ok:boolean,total:number,mismatch:number}|null} args.policy policy-check 佐证（只进 detail）
 * @param {number} [args.minComparable] independent 行的可比证据下限（默认 0 = 不设限）
 */
export function gateReport({ coverage, certify, verdicts, compare, policy, minComparable = 0 } = {}) {
  const rows = {};
  const missing = [];
  const violations = [];

  const cov = coverage?.rate;
  if (cov && Number.isFinite(cov.declared) && cov.declared > 0) {
    rows.coverage = { covered: cov.covered, declared: cov.declared, value: cov.value };
  } else {
    missing.push('coverage');
  }

  const res = certify?.summary;
  if (res && Number.isFinite(res.applicable) && res.applicable > 0) {
    rows.resistance = { caught: res.caught, applicable: res.applicable, value: res.caughtRate };
  } else {
    missing.push('resistance');
  }

  if (compare && compare.total > 0) {
    const comparable = Number.isFinite(compare.comparable) ? compare.comparable : compare.total;
    if (comparable <= 0) {
      // 两侧判决全含 unknown：这行没有一份可对照的证据，等于没跑 compare。
      missing.push('independent');
    } else {
      const detail = policy
        ? (policy.ok ? `policy 佐证 ${policy.total}/${policy.total}` : `policy 佐证不齐（mismatch ${policy.mismatch}）`)
        : null;
      rows.independent = {
        supported: compare.agree,
        total: compare.total,
        comparable,
        value: compare.agree / compare.total,
        left: compare.left,
        right: compare.right,
        detail,
      };
      if (Number.isFinite(minComparable) && minComparable > comparable) {
        violations.push(`independent：可比证据 ${comparable}/${compare.total} 低于下限 ${minComparable}`);
      }
    }
  } else {
    missing.push('independent');
  }

  const total = Array.isArray(verdicts) ? verdicts.length : 0;
  if (total > 0) {
    const unknown = verdicts.filter((v) => v && v.status === 'unknown').length;
    rows.unknown = { count: unknown, total, value: unknown / total };
  } else {
    missing.push('unknown');
  }

  return { version: GATE_VERSION, rows, missing, violations, sound: missing.length === 0 && violations.length === 0 };
}

function pct(value) {
  return (value * 100).toFixed(1) + '%';
}

export function formatGate(report) {
  const lines = [];
  lines.push(`gate —— 三层验证栈四行口径 (${report.version})`);
  if (report.missing.length > 0) {
    lines.push('');
    lines.push(`  缺行：${report.missing.join('、')}`);
    lines.push('  gate 是口径门禁：四行缺任何一行都不放行（exit 1）。');
    lines.push('  修法：--certify 默认开；--compare=第二适配器名 给独立证据；判决为零时没有可量口径。');
    lines.push('  独立证据整列 unknown 时没有可比判决，同样按缺行处理。');
    return lines.join('\n');
  }
  if (report.violations && report.violations.length > 0) {
    lines.push('');
    for (const v of report.violations) lines.push(`  红线：${v}`);
    lines.push('  --min-comparable 设的可比证据下限被击穿（exit 1）。');
    return lines.join('\n');
  }
  const r = report.rows;
  const w = '契约覆盖率　判据抗变异率　独立证据判决率　unknown 占比'.length; // 对齐用宽度参考
  lines.push(`  1 契约覆盖率      ${r.coverage.covered}/${r.coverage.declared} 能力（${pct(r.coverage.value)}）`);
  lines.push(`  2 判据抗变异率    ${r.resistance.caught}/${r.resistance.applicable} 变异体（${pct(r.resistance.value)}）`);
  const ind = r.independent;
  const indLine = `  3 独立证据判决率  ${ind.supported}/${ind.total} 判决（${pct(ind.value)}）── 可比 ${ind.comparable}/${ind.total}`;
  lines.push(indLine + (ind.detail ? `；${ind.detail}` : ''));
  if (ind.comparable < ind.total) {
    lines.push(`    注意：${ind.total - ind.comparable} 对判决里含 unknown，未进可比分母（unknown 留在分母，证据不足不冒充一致）。`);
  }
  lines.push(`  4 unknown 占比    ${r.unknown.count}/${r.unknown.total} 判决（${pct(r.unknown.value)}）── unknown 留在分母`);
  lines.push('');
  lines.push('四行齐全，放行。行值低不是 gate 红：口径门禁只管「行在不在、分母在不在」。');
  return lines.join('\n');
}

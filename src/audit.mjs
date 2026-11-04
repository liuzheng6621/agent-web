/**
 * audit —— 用一份"可信的判决"当尺子，去量另一份判决有多可信。
 *
 * 为什么需要它：`agent-web report` 里的"与预期标签一致率"是自测代理指标——
 * 预期标签是写案例的人手写的，和案例同源。用同源的东西验证同源的东西，
 * 只能证明你前后一致，不能证明你判得对。
 *
 * 真正的尺子必须来自另一个实现：同一份案例，真实后端判什么，新实现就该判什么。
 * 这一步拿真实后端的判决当 oracle，输出混淆矩阵，并把最危险的那一格单独拎出来：
 *
 *   假绿（T=fail 而 C=pass）：应用真的有问题，新实现却说没问题。
 *                            这是唯一一种会"稳定变绿"的错，也是唯一值得让 CI 红的错。
 *   假红（T=pass 而 C=fail）：应用没问题，新实现误报。吵，但不危险。
 *
 * 两个名字都按测试领域的词义用：绿=通过。假绿=漏放，假红=误报。
 */

const DECIDABLE = new Set(['pass', 'fail']);

/** 把一串判决按 case_id 建索引；同 id 后者覆盖前者。 */
export function indexVerdicts(values) {
  const map = new Map();
  if (!Array.isArray(values)) return map;
  for (const v of values) {
    if (v && typeof v.case_id === 'string' && v.case_id !== '') map.set(v.case_id, v);
  }
  return map;
}

function rate(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * 比较两份判决。
 * oracle    —— 可信的那份（通常是真实后端）
 * candidate —— 被审的那份（通常是新写/被改的实现）
 */
export function auditRuns(oracle, candidate) {
  const truth = indexVerdicts(oracle);
  const suspect = indexVerdicts(candidate);
  const ids = [...new Set([...truth.keys(), ...suspect.keys()])].sort();

  const counts = {
    truePass: 0,   // 两边都说通过
    trueFail: 0,   // 两边都说没通过
    falsePass: 0,  // oracle 说没通过，candidate 说通过  ← 假绿
    falseAlarm: 0, // oracle 说通过，candidate 说没通过  ← 假红
    blind: 0,      // oracle 判得出，candidate 判不出（unknown）
    candidate_only: 0, // oracle 判不出，candidate 敢判
    both_unknown: 0,
    only_oracle: 0,
    only_candidate: 0,
  };

  const rows = [];
  for (const id of ids) {
    const t = truth.get(id);
    const c = suspect.get(id);
    let kind;
    if (!c) { kind = 'only_oracle'; counts.only_oracle += 1; }
    else if (!t) { kind = 'only_candidate'; counts.only_candidate += 1; }
    else {
      const tb = DECIDABLE.has(t.status);
      const cb = DECIDABLE.has(c.status);
      if (!tb && !cb) { kind = 'both_unknown'; counts.both_unknown += 1; }
      else if (!tb && cb) { kind = 'candidate_only'; counts.candidate_only += 1; }
      else if (tb && !cb) { kind = 'blind'; counts.blind += 1; }
      else if (t.status === c.status) {
        kind = t.status === 'pass' ? 'truePass' : 'trueFail';
        counts[kind] += 1;
      } else if (t.status === 'pass') { kind = 'falseAlarm'; counts.falseAlarm += 1; }
      else { kind = 'falsePass'; counts.falsePass += 1; }
    }
    rows.push({
      case_id: id,
      oracle: t ? t.status : null,
      candidate: c ? c.status : null,
      kind,
      oracle_reason: t ? t.reason_code : null,
      candidate_reason: c ? c.reason_code : null,
    });
  }

  const comparable = counts.truePass + counts.trueFail + counts.falsePass + counts.falseAlarm;
  const truthDecidable = comparable + counts.blind;

  return {
    rows,
    counts,
    rates: {
      // 两份判决在"都能判"的案例上的一致率
      agreement: rate(counts.truePass + counts.trueFail, comparable),
      // 在 oracle 认为有问题的案例里，candidate 放过了多少
      false_pass: rate(counts.falsePass, counts.falsePass + counts.trueFail),
      // 在 oracle 认为没问题的案例里，candidate 误报了多少
      false_alarm: rate(counts.falseAlarm, counts.falseAlarm + counts.truePass),
      // 在 oracle 判得出来的案例里，candidate 判不出的比例
      blind: rate(counts.blind, truthDecidable),
    },
    comparable,
    truth_decidable: truthDecidable,
    // 只有假绿让整体结论不成立：真有问题却被放过，等于这份判决不能用
    sound: counts.falsePass === 0,
  };
}

const KIND_LABEL = {
  truePass: '一致·通过',
  trueFail: '一致·未通过',
  falsePass: '假绿',
  falseAlarm: '假红',
  blind: '漏判',
  candidate_only: '仅候选敢判',
  both_unknown: '双方都无法判断',
  only_oracle: '仅 oracle 有',
  only_candidate: '仅候选有',
};

export function formatAudit(report, opts = {}) {
  const c = report.counts;
  const pct = (v) => (v === null ? '—（分母为 0）' : (v * 100).toFixed(1) + '%');
  const out = [];
  out.push(`对比 ${report.rows.length} 条案例，其中 ${report.comparable} 条两份判决都能判`);
  out.push('');
  out.push('混淆矩阵：');
  out.push(`  一致·通过      ${String(c.truePass).padStart(3)}`);
  out.push(`  一致·未通过    ${String(c.trueFail).padStart(3)}`);
  out.push(`  假绿           ${String(c.falsePass).padStart(3)}   ← oracle 说有问题，候选说没问题`);
  out.push(`  假红           ${String(c.falseAlarm).padStart(3)}   ← oracle 说没问题，候选说有问题`);
  out.push(`  漏判           ${String(c.blind).padStart(3)}   ← oracle 判得出，候选判不出`);
  out.push(`  仅候选敢判     ${String(c.candidate_only).padStart(3)}   ← 不计入比率`);
  out.push(`  双方都无法判断 ${String(c.both_unknown).padStart(3)}`);
  if (c.only_oracle || c.only_candidate) {
    out.push(`  只在一侧出现   ${String(c.only_oracle + c.only_candidate).padStart(3)}   ← 案例集不同，先确认跑的是同一批`);
  }
  out.push('');
  out.push('比率：');
  out.push(`  判决一致率     ${pct(report.rates.agreement)}   =（一致通过+一致未通过）/ 都能判`);
  out.push(`  假绿率         ${pct(report.rates.false_pass)}   = 假绿 /（假绿+一致未通过）`);
  out.push(`  假红率         ${pct(report.rates.false_alarm)}   = 假红 /（假红+一致通过）`);
  out.push(`  漏判率         ${pct(report.rates.blind)}   = 漏判 /（oracle 判得出的案例）`);
  out.push('');
  if (report.sound) {
    out.push('结论：没有假绿。这份判决可以当作独立证据用。');
  } else {
    out.push(`结论：发现 ${c.falsePass} 条假绿——真的有问题，候选实现说没问题。这份判决不能当证据。`);
  }
  if (opts.detail) {
    const bad = report.rows.filter((r) => r.kind === 'falsePass' || r.kind === 'falseAlarm' || r.kind === 'blind');
    if (bad.length > 0) {
      out.push('');
      out.push('需要看的案例：');
      for (const r of bad) {
        out.push(`  ${r.case_id.padEnd(30)} ${KIND_LABEL[r.kind]}  oracle=${r.oracle}(${r.oracle_reason}) 候选=${r.candidate}(${r.candidate_reason})`);
      }
    }
  }
  return out.join('\n');
}

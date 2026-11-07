/**
 * 外部判决摄入：把别人家的测试报告翻成我们的三值词汇。
 *
 * 为什么值得做：所有人都在报「跑绿了多少条」，没人报「这些判决是谁下的」。
 * 一份 e2e 报告里 status=passed 只说明没人喊错，不说明有东西被验证过——
 * 断言是模型下的（agent.assert）时，它在我们这里等价于 blind。
 *
 * 不能做什么：这不是把外部测试当成我们的案例。案例要有初态、要能复位、要有变异体。
 * 这里只翻译判决词汇，不改判别人的产品，也不替它宣称覆盖率。
 *
 * 三条硬规矩沿用指标层：unknown 留在分母里；所有比例同时报原始计数；
 * 零分母记 null（打印成 NA），不记 0。
 */

export const INGEST_VERSION = 'agent-web/ingest-1';

// 我们认识的报告格式。认不出就说认不出，不猜字段。
export const SOURCES = {
  'e2e': {
    label: 'e2e',
    detect: (doc) => typeof doc?.schemaVersion === 'string' && /^report-\d+$/.test(doc.schemaVersion),
    parse: parseE2e,
  },
};

// 判决翻译表。表里没有的状态一律进 unmapped，绝不默认成 pass。
const E2E_STATUS = {
  passed: { verdict: 'pass', reason: null },
  failed: { verdict: 'fail', reason: null },
  flaky: { verdict: 'unknown', reason: 'flaky' },
  'timed-out': { verdict: 'unknown', reason: 'timed_out' },
  interrupted: { verdict: 'unknown', reason: 'interrupted' },
  skipped: { verdict: 'unknown', reason: 'skipped' },
};

// 一条断言是谁下的：agent.* 是模型，其余（assertion / locator / expect）是机器。
function isAssertionStep(step) {
  const api = String(step?.api ?? '');
  if (step?.kind === 'assertion') return true;
  if (/\.assert$/.test(api)) return true;
  if (/\.expect\b/.test(api)) return true;
  return /toContainText|toBeVisible|toHaveText|toEqual|toBe\b/.test(api);
}

function judgementBasis(attempts) {
  let machine = 0;
  let model = 0;
  let actions = 0;
  for (const a of attempts ?? []) {
    for (const s of a?.steps ?? []) {
      if (isAssertionStep(s)) {
        if (s.kind === 'agent' || String(s.api ?? '').startsWith('agent.')) model += 1;
        else machine += 1;
      } else if (s?.kind === 'agent') actions += 1;
    }
  }
  const total = machine + model;
  let basis;
  if (total === 0) basis = 'none';
  else if (model === 0) basis = 'machine';
  else if (machine === 0) basis = 'model';
  else basis = 'mixed';
  return { basis, machine, model, actions };
}

function parseE2e(doc) {
  const run = doc.run ?? {};
  const results = Array.isArray(run.results) ? run.results : [];
  const warnings = [];
  const unmapped = [];
  const tests = [];

  for (const r of results) {
    const raw = String(r?.status ?? '');
    const row = E2E_STATUS[raw];
    const title = Array.isArray(r?.titlePath) ? r.titlePath.filter(Boolean).join(' › ') : String(r?.title ?? r?.testId ?? r?.id ?? '(未命名)');
    const basis = judgementBasis(r?.attempts);
    // 被过滤掉、根本没跑的，不算判决，也不进分母——把它算成 pass 或 unknown 都是错的。
    const filtered = r?.selected === false || r?.skip?.cause === 'filtered';
    let verdict;
    let reason;
    if (filtered) {
      verdict = 'not_run';
      reason = 'filtered_out';
    } else if (!row) {
      unmapped.push({ title, status: raw });
      verdict = 'unknown';
      reason = 'unmapped_status:' + (raw || '(空)');
    } else {
      verdict = row.verdict;
      reason = row.reason;
    }
    // passed 且带 expectedFailure：那个已知缺陷还在，通过的是「复现」，不是「产品正常」。
    const expectedFailure = r?.expectedFailure?.reason ?? null;
    if (expectedFailure && verdict === 'pass') {
      reason = 'expected_failure_still_present';
      warnings.push({ code: 'expected_failure', title, reason: expectedFailure });
    }
    // 只有真出了判决（pass/fail）却没有一条断言时才算「什么也没证明」；
    // skipped / filtered 本来就没人声称验过东西，报警只会把噪声当我们发现问题。
    if ((verdict === 'pass' || verdict === 'fail') && basis.basis === 'none') {
      warnings.push({ code: 'no_assertion', title });
    }
    tests.push({
      title,
      status: raw,
      verdict,
      reason_code: reason,
      basis: basis.basis,
      assertions_machine: basis.machine,
      assertions_model: basis.model,
      model_actions: basis.actions,
      expected_failure: expectedFailure,
      attempts: Array.isArray(r?.attempts) ? r.attempts.length : 0,
    });
  }

  // run.errors 是运行层的事故（钩子挂了、teardown 炸了），不是产品判决。
  // 但它们让一部分测试没结论，所以必须以 unknown 进分母，不能被静默吞掉。
  const suiteErrors = (Array.isArray(run.errors) ? run.errors : []).map((e) => ({
    code: String(e?.code ?? '(无名错误)'),
    message: String(e?.message ?? ''),
    phase: e?.phase ?? null,
  }));
  return {
    schemaVersion: String(doc.schemaVersion),
    summary: run.summary ?? null,
    runner: run.runner ?? null,
    tests,
    suiteErrors,
    unmapped,
    warnings,
  };
}

function ratio(numerator, denominator) {
  if (!denominator) return { value: null, numerator, denominator };
  return { value: numerator / denominator, numerator, denominator };
}

export function ingestReport(doc, { from = null } = {}) {
  let source = from;
  if (!source) {
    source = Object.keys(SOURCES).find((k) => SOURCES[k].detect(doc)) ?? null;
  }
  if (!source || !SOURCES[source]) {
    return {
      ingest_version: INGEST_VERSION,
      source: source ?? null,
      error: 'unknown_schema',
      message: source
        ? '没有名为 ' + source + ' 的摄入器'
        : '认不出这份报告：schemaVersion 不在已知表里。认不出就说认不出，不猜字段。',
      exitCode: 2,
    };
  }
  const parsed = SOURCES[source].parse(doc);
  const inDenominator = parsed.tests.filter((t) => t.verdict !== 'not_run');
  const counted = (v) => inDenominator.filter((t) => t.verdict === v).length;
  const P = counted('pass');
  const F = counted('fail');
  // 运行层事故没有产品判决，但它们是「不知道」，必须留在分母里。
  const U = counted('unknown') + parsed.suiteErrors.length;
  // passed 且带 expectedFailure：通过的是「缺陷仍在」，不是「产品正常」。单独数一笔，
  // 免得这一个数被读成能力已经验过。
  const expectedFailureConfirmed = inDenominator.filter((t) => t.reason_code === 'expected_failure_still_present').length;
  const byBasis = { machine: 0, model: 0, mixed: 0, none: 0 };
  for (const t of inDenominator) byBasis[t.basis] = (byBasis[t.basis] ?? 0) + 1;
  const byReason = {};
  for (const t of inDenominator) {
    const k = t.verdict + '/' + (t.reason_code ?? '-');
    byReason[k] = (byReason[k] ?? 0) + 1;
  }
  for (const e of parsed.suiteErrors) {
    const k = 'unknown/suite_error:' + e.code;
    byReason[k] = (byReason[k] ?? 0) + 1;
  }
  const report = {
    ingest_version: INGEST_VERSION,
    source,
    schema_version: parsed.schemaVersion,
    runner: parsed.runner,
    declared_summary: parsed.summary,
    counts: {
      results: parsed.tests.length,
      total: inDenominator.length + parsed.suiteErrors.length,
      in_denominator: inDenominator.length + parsed.suiteErrors.length,
      expected_failure_confirmed: expectedFailureConfirmed,
      not_run: parsed.tests.length - inDenominator.length,
      pass: P,
      fail: F,
      unknown: U,
      suite_errors: parsed.suiteErrors.length,
    },
    // 分母 = 有判决意图的结果 + 运行层事故。事故让一部分测试根本没结论，
    // 把它排除在分母外，就等于替产品把这部分判成了过。
    judgeable: ratio(P + F, inDenominator.length + parsed.suiteErrors.length),
    // 只有机器判定的判决才跨得了实现。这一格是这份报告里最该被看见的数。
    machine_share: ratio(byBasis.machine, P + F),
    by_basis: byBasis,
    by_reason: byReason,
    tests: parsed.tests,
    suite_errors: parsed.suiteErrors,
    unmapped: parsed.unmapped,
    warnings: parsed.warnings,
  };
  report.exitCode = parsed.unmapped.length > 0 ? 2 : 0;
  return report;
}

const pct = (r) => (r.value === null ? 'NA' : (r.value * 100).toFixed(1) + '%');
function countLine(label, n, note) {
  return '    ' + String(label).padEnd(9, ' ') + String(n).padStart(4, ' ') + (note ? '   ' + note : '');
}

export function formatIngest(report) {
  if (report.error) {
    const out = [];
    out.push('外部报告摄入 · 认不出来');
    out.push('');
    out.push('  ' + report.message);
    out.push('');
    out.push('  现在认识的格式：' + Object.keys(SOURCES).join(' / ') + '（e2e 的 report-1 及以后）');
    return out.join('\n');
  }
  const c = report.counts;
  const out = [];
  out.push('外部报告摄入 · ' + report.source + ' · ' + report.schema_version
    + (report.runner ? '（runner ' + report.runner.name + '@' + report.runner.version + '）' : ''));
  out.push('');
  out.push('  判决翻译（' + c.results + ' 条结果'
    + (c.suite_errors ? ' + ' + c.suite_errors + ' 条运行层事故' : '') + '）');
  out.push(countLine('pass', c.pass));
  out.push(countLine('fail', c.fail));
  out.push(countLine('unknown', c.unknown, 'flaky / timed-out / interrupted / skipped 都不算过'));
  if (c.not_run) out.push(countLine('未跑', c.not_run, '被过滤掉的，不进分母'));
  out.push('');
  out.push('  可判定率 ' + report.judgeable.numerator + '/' + report.judgeable.denominator
    + ' = ' + pct(report.judgeable) + '   （分母里含 unknown）');
  out.push('  机器判定占比 ' + report.machine_share.numerator + '/' + report.machine_share.denominator
    + ' = ' + pct(report.machine_share) + '   ← 只有这几条判决跨得了实现');
  out.push('');
  const b = report.by_basis;
  out.push('  这些判决是谁下的');
  out.push('    机器断言 ' + b.machine + ' · 模型断言 ' + b.model + ' · 两者都有 ' + b.mixed
    + ' · 一条断言都没有 ' + b.none);
  if (b.none) out.push('    最后那 ' + b.none + ' 条在我们口径里是 blind：它们通过什么也没证明。');
  if (report.suite_errors.length) {
    out.push('');
    out.push('  运行层事故 ' + report.suite_errors.length + ' 条（不是产品判决，但让一部分测试没结论）');
    for (const e of report.suite_errors) out.push('    ' + e.code + '  ' + e.message.slice(0, 70));
  }
  if (report.unmapped.length) {
    out.push('');
    out.push('  不认识的状态 ' + report.unmapped.length + ' 个：认不出就说认不出，不默认成 pass');
    for (const u of report.unmapped.slice(0, 8)) out.push('    ' + (u.status || '(空)') + '  ' + u.title);
  }
  if (report.warnings.length) {
    out.push('');
    out.push('  需要看一眼的 ' + report.warnings.length + ' 处');
    const seen = new Set();
    for (const w of report.warnings) {
      if (seen.has(w.code)) continue;
      seen.add(w.code);
      const what = w.code === 'expected_failure'
        ? 'passed 但声明了「预期的失败」：通过的可能是复现，不是产品正常'
        : '没有任何断言行：它通过什么也没证明';
      out.push('    ' + w.code.padEnd(18, ' ') + what);
    }
    for (const w of report.warnings.slice(0, 6)) {
      out.push('      · ' + w.title + (w.reason ? '（' + w.reason + '）' : ''));
    }
  }
  return out.join('\n');
}

export function ingestExit(report) {
  return report.exitCode ?? 0;
}

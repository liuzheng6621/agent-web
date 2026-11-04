// 能力覆盖率：把「manifest 声明了什么」和「案例真正用了什么」对上账。
//
// 为什么值得单独做一件事：coverage_gap 只是判决时被动记一笔，
// 它回答不了「这套案例到底碰过这个系统的多少面」。两个数字必须分开：
//   · 声明了但从没被用到 —— 不是 bug，只说明案例还不够狠；
//   · 案例要了但没声明   —— 是缺口，判决只会是 unknown，永远测不到。
// 把它们合成一个「覆盖率」会立刻误导人，所以下面一直分开报。

export const COVERAGE_VERSION = 'agent-web/coverage-1';

const ratio = (covered, declared) => ({
  covered,
  declared,
  value: declared === 0 ? null : covered / declared,
});

/**
 * 把案例集与一份 manifest 对上账。
 * @param {Array<object>} cases 已通过校验的案例
 * @param {object} manifest 适配器 manifest
 */
export function collectUsage(cases, manifest) {
  const declared = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  const byId = new Map(declared.map((c) => [c.id, c]));

  // 每条被案例要求的能力：谁要的、要了几步。
  const required = new Map();
  const scopeAsk = new Map();

  for (const c of cases) {
    const caseId = c?.id ?? '(未命名)';
    const steps = Array.isArray(c?.reference_trajectory) ? c.reference_trajectory : [];
    for (const s of steps) {
      const id = s?.capability;
      if (typeof id !== 'string' || id === '') continue;
      const rec = required.get(id) ?? { id, cases: new Set(), steps: 0 };
      rec.cases.add(caseId);
      rec.steps += 1;
      required.set(id, rec);
    }
    const scopes = Array.isArray(c?.observability?.declared_scopes) ? c.observability.declared_scopes : [];
    for (const sc of scopes) {
      const rec = scopeAsk.get(sc) ?? { scope: sc, cases: new Set() };
      rec.cases.add(caseId);
      scopeAsk.set(sc, rec);
    }
  }

  const rows = [];
  for (const cap of declared) {
    const use = required.get(cap.id);
    rows.push({
      id: cap.id,
      kind: cap.kind ?? 'unknown',
      evidence_level: cap.evidence_level ?? 'unknown',
      cases: use ? [...use.cases] : [],
      steps: use ? use.steps : 0,
    });
  }

  const missing = [];
  for (const [id, rec] of required) {
    if (byId.has(id)) continue;
    missing.push({ id, cases: [...rec.cases], steps: rec.steps });
  }

  const declaredScopes = new Set(Array.isArray(manifest?.scopes) ? manifest.scopes : []);
  const scopeMissing = [];
  const scopeCovered = [];
  for (const [sc, rec] of scopeAsk) {
    (declaredScopes.has(sc) ? scopeCovered : scopeMissing).push({ scope: sc, cases: [...rec.cases] });
  }

  return {
    version: COVERAGE_VERSION,
    adapter: manifest?.adapter ?? 'unknown',
    adapter_version: manifest?.adapter_version ?? null,
    cases: cases.length,
    rows,
    missing,
    scope_missing: scopeMissing,
    scope_covered: scopeCovered,
    declared_scopes: [...declaredScopes],
  };
}

export function summarizeCoverage(usage) {
  const used = usage.rows.filter((r) => r.cases.length > 0);
  const unused = usage.rows.filter((r) => r.cases.length === 0);

  const byKind = {};
  for (const r of usage.rows) {
    const k = (byKind[r.kind] ??= { kind: r.kind, declared: 0, used: 0 });
    k.declared += 1;
    if (r.cases.length > 0) k.used += 1;
  }

  const evidence = {};
  for (const r of used) {
    const k = (evidence[r.evidence_level] ??= { level: r.evidence_level, claimed_by: 0, used: 0 });
    k.used += 1;
  }
  for (const r of usage.rows) {
    if (evidence[r.evidence_level]) evidence[r.evidence_level].claimed_by += 1;
  }

  return {
    version: usage.version,
    adapter: usage.adapter,
    adapter_version: usage.adapter_version,
    cases: usage.cases,
    declared: usage.rows.length,
    used: used.length,
    unused: unused.length,
    missing: usage.missing.length,
    rate: ratio(used.length, usage.rows.length),
    by_kind: Object.values(byKind).sort((a, b) => a.kind.localeCompare(b.kind)),
    evidence: Object.values(evidence).sort((a, b) => a.level.localeCompare(b.level)),
    scope: {
      declared: usage.declared_scopes.length,
      asked: usage.scope_covered.length + usage.scope_missing.length,
      missing: usage.scope_missing.length,
    },
    unused_list: unused.map((r) => ({ id: r.id, kind: r.kind, evidence_level: r.evidence_level })),
    missing_list: usage.missing,
    scope_missing_list: usage.scope_missing,
    scope_covered_list: usage.scope_covered,
  };
}

const pct = (r) => (r.value === null ? '—（分母为 0）' : `${(r.value * 100).toFixed(1)}%`);

export function formatCoverage(report, { detail = false } = {}) {
  const out = [];
  out.push(`适配器 ${report.adapter}${report.adapter_version ? `（版本 ${report.adapter_version}）` : ''}`);
  out.push(`案例 ${report.cases} 条`);
  out.push('');
  out.push('一、能力对账');
  out.push(`  声明能力        ${report.declared}`);
  out.push(`  被案例用到      ${report.used}`);
  out.push(`  从未被用到      ${report.unused}   ← 不是 bug，只说明案例还没碰到它`);
  out.push(`  案例要但没声明  ${report.missing}   ← 是缺口，这类步只会判 unknown`);
  out.push(`  覆盖率          ${pct(report.rate)}   = 被用到的能力 / 声明的能力`);

  if (report.by_kind.length > 0) {
    out.push('');
    out.push('二、按类别');
    for (const k of report.by_kind) {
      out.push(`  ${k.kind.padEnd(8)} 声明 ${String(k.declared).padStart(2)}   用到 ${String(k.used).padStart(2)}`);
    }
  }

  if (report.evidence.length > 0) {
    out.push('');
    out.push('三、证据等级（只看被用到的那几条）');
    for (const e of report.evidence) {
      const note = e.level === 'validated' ? '' : e.level === 'observed' ? '   ← 看见过，没专门验证' : '   ← 推测出来的，别当事实';
      out.push(`  ${e.level.padEnd(10)} ${e.used}/${e.claimed_by}${note}`);
    }
  }

  out.push('');
  out.push('四、观测域');
  out.push(`  manifest 声明 ${report.scope.declared}   案例需要 ${report.scope.asked}   案例要但没声明 ${report.scope.missing}`);

  if (detail) {
    if (report.unused_list.length > 0) {
      out.push('');
      out.push('从未被用到的能力：');
      for (const u of report.unused_list) out.push(`  · ${u.id} (${u.kind}, ${u.evidence_level})`);
    }
    if (report.missing_list.length > 0) {
      out.push('');
      out.push('案例要但 manifest 没声明：');
      for (const m of report.missing_list) {
        out.push(`  · ${m.id}  ← ${m.cases.length} 条案例要用它（${m.steps} 步）`);
        for (const id of m.cases) out.push(`      ${id}`);
      }
    }
    if (report.scope_missing_list.length > 0) {
      out.push('');
      out.push('案例要观测但 manifest 没声明的集合：');
      for (const sc of report.scope_missing_list) out.push(`  · ${sc.scope}  ← ${sc.cases.join(', ')}`);
    }
  }

  return out.join('\n');
}

/** 出口判据：有缺口就算不通过；也可以要求一个最低覆盖率。 */
export function coverageVerdict(report, { min = null } = {}) {
  if (report.missing > 0) {
    return { ok: false, why: `有 ${report.missing} 条能力被案例要求但 manifest 没声明` };
  }
  if (min !== null && (report.rate.value === null || report.rate.value < min)) {
    return { ok: false, why: `覆盖率 ${pct(report.rate)} 低于要求的 ${(min * 100).toFixed(1)}%` };
  }
  return { ok: true, why: '' };
}

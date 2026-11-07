/**
 * 陷阱普查。
 *
 * audit 问的是「判决器自己漏了多少」，需要两个实现对照。
 * traps 问的是另一件事：**这批判决里有多少条是在盲区里产生的**，只需一份判决 + 案例集。
 *
 * 每条判决对每个陷阱给出四种状态之一：
 *   absent   结构上不涉及这个陷阱
 *   guarded  涉及，且判决带着可核对的凭据（有据可查，不等于绝对安全）
 *   blind    涉及，但判决看起来有结论，风险却无法从判决本身排除
 *   unusable 判决本身无效（环境故障 / 契约违约），既不算抓住也不算盲区
 *
 * 这个工具的作用是让体检报告变难看。一份全是 pass 的判决列表，
 * 在这里会显出「其中有多少条其实什么也没证明」。
 */

export const TRAPS_VERSION = 'agent-web/traps-1';

const FINAL_KINDS = new Set(['entity_exists', 'field_equals', 'count_delta', 'unchanged']);

/**
 * 哪些 reason_code 意味着「这条判决不成立」，而不是「这条判决发现不了问题」。
 *
 * 只列 infrastructure_error 是个坑：v0.60.0 / v0.61.0 又加了两个未知码，
 * 它们同样表示「这一次什么都没测成」，漏掉就会被算进盲区——
 * 把「没测」报成「测了但看不出来」，方向正好相反。
 * 判据：这个码是否说明**这一次执行本身不可信**，与产品无关。
 */
export const UNUSABLE_CODES = new Set([
  'infrastructure_error',
  'contract_violation',
  'effect_uncertain',
]);
const TRACE_KINDS = new Set(['status_transition', 'event_absent']);

function allAssertions(c) {
  return [...(c?.task?.goal_assertions ?? []), ...(c?.task?.invariants ?? [])];
}

function collectKinds(a, out = []) {
  if (!a || typeof a !== 'object') return out;
  if (a.kind === 'composite') {
    for (const x of a.args ?? []) collectKinds(x, out);
    return out;
  }
  if (a.kind) out.push(a.kind);
  return out;
}

function steps(c) {
  return Array.isArray(c?.reference_trajectory) ? c.reference_trajectory : [];
}

export const TRAPS = [
  {
    id: 'identity-collapse',
    exhibit: 'e01',
    title: '身份塌缩',
    question: '每一步真的由案例声称的那个人执行吗？',
    scan(verdict, c) {
      const roles = new Set(steps(c).map((s) => s.as).filter(Boolean));
      if (roles.size < 2) return { state: 'absent', detail: '案例只涉及一个角色' };

      const bindings = verdict?.evidence?.role_bindings;
      const trace = Array.isArray(verdict?.evidence?.trace) ? verdict.evidence.trace : [];
      const seen = trace.filter((t) => t && t.identity);

      if (seen.length === 0) {
        return { state: 'blind', detail: '适配器没有上报执行身份，这局的身份无从核对' };
      }
      for (const t of trace) {
        if (!t || !t.as || !t.identity) continue;
        const expected = bindings ? bindings[t.as] : undefined;
        if (expected && expected !== t.identity) {
          return {
            state: 'blind',
            detail: `第 ${t.index + 1} 步声明 as=${t.as}（应绑 ${expected}），实际由 ${t.identity} 执行`,
          };
        }
      }
      if (!bindings) {
        return { state: 'blind', detail: '复位没有声明角色映射，身份一致性无法核对' };
      }
      return { state: 'guarded', detail: `${roles.size} 个角色的执行身份与声明一致` };
    },
  },

  {
    id: 'event-vocabulary',
    exhibit: 'e02',
    title: '事件词表缺失',
    question: '「没发生」是真的没发生，还是根本没记？',
    scan(verdict, c) {
      const kinds = allAssertions(c).flatMap((a) => collectKinds(a));
      if (!kinds.includes('event_absent')) return { state: 'absent', detail: '没有 event_absent 断言' };

      const env = verdict?.evidence?.environment ?? {};
      if (verdict?.reason_code === 'unsupported_event') {
        return { state: 'guarded', detail: '事件类型不在词表内，已判 unknown' };
      }
      if (env.events_complete === false) {
        return { state: 'blind', detail: '事件流水不完整，event_absent 无法证明任何事' };
      }
      if (!Array.isArray(env.events_types)) {
        return { state: 'blind', detail: '适配器没有声明事件词表，event_absent 在裸奔' };
      }
      return { state: 'guarded', detail: `事件词表声明了 ${env.events_types.length} 类` };
    },
  },

  {
    id: 'draft-gate',
    exhibit: 'e03',
    title: '草稿闸门',
    question: '这张考卷有人看过吗？',
    scan(verdict, c) {
      const d = c?.draft;
      if (!d || d.status === 'confirmed') return { state: 'absent', detail: '不是未确认草稿' };
      if (verdict?.reason_code === 'unconfirmed_draft') {
        return { state: 'guarded', detail: '未确认草稿已判 unknown' };
      }
      return { state: 'blind', detail: `草稿状态 ${d.status}，却产生了 ${verdict?.status} 判决` };
    },
  },

  {
    id: 'terminal-only',
    exhibit: '—',
    title: '只看终态',
    question: '结果凑对了，过程能不能乱来？',
    scan(verdict, c) {
      const kinds = allAssertions(c).flatMap((a) => collectKinds(a));
      if (kinds.some((k) => TRACE_KINDS.has(k))) {
        return { state: 'absent', detail: '有过程类断言（status_transition / event_absent）' };
      }
      if (!kinds.some((k) => FINAL_KINDS.has(k))) {
        return { state: 'absent', detail: '没有终态类断言可依赖' };
      }
      return {
        state: 'blind',
        detail: '只有终态断言：过程乱来但结果凑对，这条判决看不出来',
      };
    },
  },
];

/** 对单条判决跑全部陷阱。 */
export function scanVerdict(verdict, caseObj) {
  if (verdict && UNUSABLE_CODES.has(verdict.reason_code)) {
    const why = verdict.reason_code === 'infrastructure_error'
      ? '环境故障'
      : verdict.reason_code === 'contract_violation'
        ? '适配器违约，判定权威不在'
        : '可能已生效，结果不可知';
    return TRAPS.map((t) => ({ trap: t.id, state: 'unusable', detail: `判决本身无效（${why}）` }));
  }
  return TRAPS.map((t) => {
    let r;
    try {
      r = t.scan(verdict, caseObj);
    } catch (e) {
      r = { state: 'blind', detail: `探测器自身出错：${e && e.message}` };
    }
    return { trap: t.id, state: r.state ?? 'blind', detail: r.detail ?? '' };
  });
}

/** 汇总一批 (verdict, case) 的普查结果。 */
export function summarizeTraps(pairs) {
  const byTrap = new Map(TRAPS.map((t) => [t.id, { id: t.id, exhibit: t.exhibit, title: t.title, question: t.question, applicable: 0, guarded: 0, blind: 0, details: [] }]));
  let unusable = 0;
  let total = 0;

  for (const { verdict, case: c } of pairs) {
    total += 1;
    const rows = scanVerdict(verdict, c);
    if (rows.every((r) => r.state === 'unusable')) unusable += 1;
    for (const r of rows) {
      const t = byTrap.get(r.trap);
      if (r.state === 'absent') continue;
      if (r.state === 'unusable') continue;
      t.applicable += 1;
      if (r.state === 'guarded') t.guarded += 1;
      if (r.state === 'blind') {
        t.blind += 1;
        if (t.details.length < 20) {
          t.details.push({ case_id: verdict?.case_id ?? '<unknown>', detail: r.detail });
        }
      }
    }
  }

  const traps = [...byTrap.values()].map((t) => ({
    ...t,
    rate: t.applicable === 0 ? null : t.blind / t.applicable,
  }));

  const applicableTotal = traps.reduce((s, t) => s + t.applicable, 0);
  const blindTotal = traps.reduce((s, t) => s + t.blind, 0);

  return {
    version: TRAPS_VERSION,
    total,
    unusable,
    traps,
    blind_total: blindTotal,
    applicable_total: applicableTotal,
    // 分母是「所有涉及到的风险点」，不是案例数：一条案例可能同时踩多个坑。
    blind_rate: applicableTotal === 0 ? null : blindTotal / applicableTotal,
  };
}

export function trapVerdict(report, { maxBlind = 0 } = {}) {
  if (report.blind_rate === null) return { ok: true, reason: '没有涉及任何陷阱' };
  if (report.blind_rate <= maxBlind) {
    return { ok: true, reason: `盲区率 ${(report.blind_rate * 100).toFixed(1)}% ≤ 上限 ${(maxBlind * 100).toFixed(1)}%` };
  }
  return {
    ok: false,
    reason: `盲区率 ${(report.blind_rate * 100).toFixed(1)}% 超过上限 ${(maxBlind * 100).toFixed(1)}%`,
  };
}

function pct(r) {
  return r === null ? '—（分母为 0）' : `${(r * 100).toFixed(1)}%`;
}

export function formatTraps(report, { detail = false } = {}) {
  const lines = [];
  lines.push(`陷阱普查（${report.total} 条判决）`);
  lines.push('');
  lines.push('  陷阱              涉及   有据可查   盲区   盲区率');
  const pad = (s, n) => String(s).padEnd(n, ' ');
  const num = (n, n2) => String(n).padStart(n2, ' ');
  for (const t of report.traps) {
    lines.push(`  ${pad(t.title, 14)} ${num(t.applicable, 6)} ${num(t.guarded, 10)} ${num(t.blind, 6)}   ${pct(t.rate)}`);
  }
  lines.push('');
  lines.push(`  盲区风险点：${report.blind_total}/${report.applicable_total}   盲区率 ${pct(report.blind_rate)}`);
  if (report.unusable > 0) {
    lines.push(`  作废判决：${report.unusable}/${report.total}（执行本身不可信，本来就不该计分）`);
  }
  if (detail) {
    const withDetails = report.traps.filter((t) => t.details.length > 0);
    if (withDetails.length > 0) {
      lines.push('');
      lines.push('明细（最多列 20 条）：');
      for (const t of withDetails) {
        lines.push(`  [${t.title}]`);
        for (const d of t.details) lines.push(`    ${d.case_id}  ${d.detail}`);
      }
    }
  }
  return lines.join('\n');
}

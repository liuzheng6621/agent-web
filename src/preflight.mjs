/**
 * preflight —— 跑之前先问「这条案例会落到哪一类判决」
 *
 * 现状：一条案例要 reset 一次、跑完全程、观测两次，才告诉你 unknown 或 fail。
 * 其中相当一部分是**静态可知**的：能力没声明、身份不在允许集里、断言的集合不在
 * 视图契约里、事件类型不在词表里 —— 这些不需要执行任何一步。
 *
 * 这里只做一件事：拿清单的**声明**和案例的要求对账，预测它会被判成什么。
 *
 *   unknown  必然判不了：能力缺失 / 集合不可观测 / 事件词表缺类型
 *   fail     必然失败：某个「期望成功」的步骤用了清单不允许的身份，那一步会被拒
 *   ready    没有静态可判的死因，跑下去才知道
 *
 * 预测值要和 `expected.json` 的标签对上，对不上才是问题 —— 因为仓库里本来就有
 * 故意写坏的案例（`coffee/unknown-capability` 就是拿来验证 unknown 路径的）。
 * 把「预测 unknown 而预期就是 unknown」当成错，等于让人去修对的那一头。
 *
 * 两列分开报、不合成一个总分，借的是 DeepSpeed `ds_report` 的形状：
 * 它把 op 的 installed 与 compatible 分成两列，并明写「没装 ≠ 不兼容」。
 */

/** 断言里引用集合的字段：selector.collection 是主入口，relation/linkage 另有 from/to。 */
function collectionsOf(assertion, out = new Set()) {
  if (!assertion || typeof assertion !== 'object') return out;
  if (assertion.kind === 'composite') {
    for (const a of assertion.args ?? []) collectionsOf(a, out);
    return out;
  }
  const s = assertion.selector;
  if (s && typeof s.collection === 'string') out.add(s.collection);
  if (typeof assertion.collection === 'string') out.add(assertion.collection);
  if (typeof assertion.from === 'string') out.add(assertion.from);
  if (typeof assertion.to === 'string') out.add(assertion.to);
  return out;
}

function eventTypesOf(assertion, out = new Set()) {
  if (!assertion || typeof assertion !== 'object') return out;
  if (assertion.kind === 'composite') {
    for (const a of assertion.args ?? []) eventTypesOf(a, out);
    return out;
  }
  if (assertion.kind === 'event_absent' && typeof assertion.type === 'string') out.add(assertion.type);
  return out;
}

function allAssertions(c) {
  return [...(c?.task?.goal_assertions ?? []), ...(c?.task?.invariants ?? [])];
}

/**
 * 单条案例的静态体检。
 * @param {{case: object, manifest: object}} opts
 */
export function preflightCase({ case: c, manifest }) {
  const caps = new Map((manifest?.capabilities || []).map((x) => [x.id, x]));
  const roles = Array.isArray(manifest?.roles) ? manifest.roles : null;
  const declaredCollections = manifest?.view?.collections
    ? new Set(Object.keys(manifest.view.collections))
    : null;
  const vocabulary = Array.isArray(manifest?.events_types) ? new Set(manifest.events_types) : null;

  const missing = {
    capabilities: new Set(),
    roles: new Set(),
    role_rules: new Set(),
    collections: new Set(),
    events: new Set(),
  };
  const steps = Array.isArray(c?.reference_trajectory) ? c.reference_trajectory : [];

  for (const s of steps) {
    const cap = caps.get(s.capability);
    if (!cap) {
      missing.capabilities.add(String(s.capability));
      continue;
    }
    if (roles && s.as && !roles.includes(s.as)) missing.roles.add(String(s.as));
    // 负例故意用错身份是合法的：只有「期望成功」的步骤才要求身份在允许集里。
    const allowed = Array.isArray(cap.roles) ? cap.roles : null;
    if (allowed && allowed.length > 0 && s.as && !allowed.includes(s.as) && s.expected_outcome === 'applied') {
      missing.role_rules.add(`${s.capability} 不接受 ${s.as}`);
    }
  }

  const collections = new Set();
  const events = new Set();
  for (const a of allAssertions(c)) {
    collectionsOf(a, collections);
    eventTypesOf(a, events);
  }
  if (declaredCollections) {
    for (const name of collections) if (!declaredCollections.has(name)) missing.collections.add(name);
  }
  if (vocabulary) {
    for (const t of events) if (!vocabulary.has(t)) missing.events.add(t);
  }

  // 顺序要紧：能力缺失先于身份，否则一条案例会因为「身份不在清单里」被误报成 fail。
  const unknownCauses =
    missing.capabilities.size + missing.roles.size + missing.collections.size + missing.events.size;
  const failCauses = missing.role_rules.size;
  const predicted = unknownCauses > 0 ? 'unknown' : failCauses > 0 ? 'fail' : 'ready';

  const checks = [
    {
      axis: 'capability',
      ok: missing.capabilities.size === 0,
      detail: missing.capabilities.size === 0
        ? '案例用到的能力都在清单里'
        : '清单里没有：' + [...missing.capabilities].join(', ') + '（这一步判 unknown）',
    },
    {
      axis: 'role',
      ok: missing.roles.size === 0 && missing.role_rules.size === 0,
      detail: missing.roles.size + missing.role_rules.size === 0
        ? '每一步的身份都在清单允许范围内'
        : [...[...missing.roles].map((r) => '未声明身份 ' + r), ...missing.role_rules].join('；'),
    },
    {
      axis: 'observation',
      ok: missing.collections.size === 0,
      detail: missing.collections.size === 0
        ? '断言引用的集合都在视图契约里'
        : '视图契约里没有：' + [...missing.collections].join(', ') + '（断言判 unknown）',
    },
    {
      axis: 'event_vocabulary',
      ok: missing.events.size === 0,
      detail: missing.events.size === 0
        ? '事件断言用的类型都在词表里'
        : '词表里没有：' + [...missing.events].join(', ') + '（这些断言判 unknown，不是 pass）',
    },
  ];

  return {
    case_id: c?.id ?? '<unnamed>',
    predicted,
    checks,
    missing: {
      capabilities: [...missing.capabilities],
      roles: [...missing.roles],
      role_rules: [...missing.role_rules],
      collections: [...missing.collections],
      events: [...missing.events],
    },
  };
}

/**
 * 预测与 expected.json 的标签是否自洽。
 * 没有标签时只拦「必然 unknown」——fail 预测本身不是错，它只是提前说了会红。
 */
export function consistency(result, expected) {
  if (expected === undefined) return result.predicted !== 'unknown';
  if (result.predicted === 'unknown') return expected === 'unknown' || expected === 'invalid';
  if (result.predicted === 'fail') return expected === 'fail';
  return true;
}

export function preflightAll({ cases, manifest, expected = {} }) {
  return (cases || []).map((c) => {
    const result = preflightCase({ case: c, manifest });
    const exp = expected[result.case_id];
    return { ...result, expected: exp ?? null, consistent: consistency(result, exp) };
  });
}

const LABEL = { ready: 'ready', unknown: 'unknown', fail: 'fail' };

/** 表格式输出：每列独立，不合成一个总分。 */
export function formatPreflight(results, { detail = false } = {}) {
  const lines = [];
  const counts = { ready: 0, unknown: 0, fail: 0 };
  for (const r of results) counts[r.predicted] += 1;
  const bad = results.filter((r) => !r.consistent).length;

  lines.push(
    `预检 · ${results.length} 条案例 · 预测 ready ${counts.ready} / unknown ${counts.unknown} / fail ${counts.fail}` +
      (bad > 0 ? ` · 与预期不符 ${bad}` : ''),
  );
  lines.push('');
  lines.push('  预测     能力  身份  观测  词表  预期     案例');
  for (const r of results) {
    const [cap, role, obs, vocab] = r.checks;
    const cell = (x) => (x.ok ? ' ok ' : ' -- ');
    const exp = r.expected === null ? '   -  ' : String(r.expected).padEnd(6);
    const flag = r.consistent ? ' ' : '!';
    lines.push(
      `  ${LABEL[r.predicted].padEnd(8)}${cell(cap)}${cell(role)}${cell(obs)}${cell(vocab)}${exp}${flag} ${r.case_id}`,
    );
    if (detail) {
      for (const chk of r.checks) {
        if (!chk.ok) lines.push(`      ${chk.axis}: ${chk.detail}`);
      }
    }
  }
  if (counts.unknown > 0 || counts.fail > 0) {
    lines.push('');
    lines.push('  unknown = 静态就能判死：能力/身份/集合/词表缺一样，跑完也拿不到结论。');
    lines.push('  fail    = 某个「期望成功」的步骤用了清单不允许的身份，那一步会被拒。');
    lines.push('  行尾 ! = 预测与 expected.json 对不上，那才是要修的东西。');
  }
  return lines.join('\n');
}

/** 有预测与预期不符就算不通过：预检的价值就在于拦在跑批之前。 */
export function preflightExit(results) {
  return results.every((r) => r.consistent) ? 0 : 1;
}

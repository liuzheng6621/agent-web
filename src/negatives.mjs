/**
 * negatives —— 从「声明」派生负例候选，不替人决定期望
 *
 * L4 的老问题是：负例的判据是「应该允许什么」，而机器只看得到「实际返回了什么」。
 * 照实际抄就是放水，所以 draft 一直只列待办、不生成。
 *
 * 这一层换了个前提：不猜观测，只读声明。声明里有三样东西是可机械判定的：
 *
 *   1) 必填参数   —— args 里不带 `?` 的，缺了就不该成功
 *   2) 角色约束   —— roles 里没有的身份，调了就不该成功
 *   3) 类型约束   —— 声明成 integer 的塞字符串，不该被静默接收
 *
 * 另外两类只能提出「问题」，不能提出「答案」：
 *
 *   4) 不存在的实体 —— 声明说主键，那查不到就该 4xx；但 404 与「返回空对象」是产品决定
 *   5) 重复提交     —— 幂等还是拒绝，纯业务选择，两个假设都列出来，人选一个
 *
 * 铁律：每条候选都带 status: 'disputed'，永远不写进 cases/。
 * 生成物只是审阅表，`accept` 仍然要人署名。
 */

import fs from 'node:fs';
import path from 'node:path';

/** `number?` → optional；`Array<{...}>` 里带 `?` 的不算整体可选。 */
export function isOptionalType(type) {
  return /\?\s*$/.test(String(type));
}

/** 去掉可选标记后的类型名。 */
export function baseType(type) {
  return String(type).trim().replace(/\?\s*$/, '').trim();
}

/** 主键类参数：名字以 id 结尾，或就是契约里的路径参数名。 */
export function looksLikeKey(name) {
  const s = String(name);
  return /(^id$)|(Id$)|(ID$)|(_id$)|^(slug|username)$/.test(s);
}

/** 不存在的实体用什么值代替：按声明类型给一个不可能存在的哨兵。 */
export function absentValue(type) {
  const t = baseType(type).toLowerCase();
  if (t === 'integer' || t === 'int' || t === 'number') return 987654321;
  return '__agent_web_absent__';
}

/** 类型不符用什么值：声明是数字就给字符串，声明是字符串就给对象。 */
export function wrongTypeValue(type) {
  const t = baseType(type).toLowerCase();
  if (t === 'integer' || t === 'int' || t === 'number') return 'not-a-number';
  if (t === 'string') return { unexpected: 'object' };
  if (t.startsWith('array')) return 'not-an-array';
  return null;
}

const WRITE_KIND = new Set(['write', 'action', 'command']);

function argsOf(step) {
  return { ...(step.arguments || {}), ...(step.bindings || {}) };
}

function dropArg(step, name) {
  const next = JSON.parse(JSON.stringify(step));
  if (next.arguments) delete next.arguments[name];
  if (next.bindings) delete next.bindings[name];
  for (const k of ['arguments', 'bindings']) {
    if (next[k] && Object.keys(next[k]).length === 0) delete next[k];
  }
  return next;
}

function setArg(step, name, value) {
  const next = JSON.parse(JSON.stringify(step));
  if (next.bindings && name in next.bindings) delete next.bindings[name];
  if (next.bindings && Object.keys(next.bindings).length === 0) delete next.bindings;
  next.arguments = { ...(next.arguments || {}), [name]: value };
  return next;
}

/**
 * 按点号路径写值：`items[].qty` 会写进数组每一项，`a.b` 写进嵌套对象。
 * 只支持「点号 + 数组通配」，够用且不引入表达式引擎。
 */
function setPathArg(step, path, value) {
  const next = JSON.parse(JSON.stringify(step));
  if (next.bindings) {
    // 被改的那个叶子如果原来是绑定来的，绑定要撤掉，否则改了个没人读的字段
    const leaf = path.split('.').pop().replace(/\[\]/g, '');
    delete next.bindings[leaf];
    if (Object.keys(next.bindings).length === 0) delete next.bindings;
  }
  const segs = path.split('.');
  const walk = (obj, i) => {
    const seg = segs[i];
    const isLast = i === segs.length - 1;
    const wildcard = seg.endsWith('[]');
    const key = wildcard ? seg.slice(0, -2) : seg;
    if (isLast) {
      obj[key] = value;
      return;
    }
    if (wildcard) {
      const arr = Array.isArray(obj[key]) ? obj[key] : [];
      obj[key] = arr.map((item) => {
        const copy = typeof item === 'object' && item !== null ? { ...item } : item;
        walk(copy, i + 1);
        return copy;
      });
      return;
    }
    obj[key] = typeof obj[key] === 'object' && obj[key] !== null ? { ...obj[key] } : {};
    walk(obj[key], i + 1);
  };
  next.arguments = next.arguments || {};
  // 目标路径的根键必须是案例本来就有的参数，否则造出来的是一条「传了奇怪参数」的负例
  const root = segs[0].replace(/\[\]/g, '');
  if (!(root in next.arguments)) return null;
  walk(next.arguments, 0);
  return next;
}

/** 从一个声明的约束里取出「该试哪些边界值」。只试声明过的，不猜。 */
function boundaryProbes(path, spec, given) {
  const probes = [];
  if (Number.isFinite(spec.min)) {
    probes.push({ label: `min-1 (${spec.min - 1})`, value: spec.min - 1 });
  }
  if (Number.isFinite(spec.max)) {
    probes.push({ label: `max+1 (${spec.max + 1})`, value: spec.max + 1 });
  }
  if (spec.integer) {
    probes.push({ label: 'non-integer', value: (Number.isFinite(spec.min) ? spec.min : 1) + 0.5 });
  }
  if (Array.isArray(spec.enum) && spec.enum.length > 0) {
    probes.push({ label: 'outside enum', value: '__not_in_enum__' });
  }
  // 值本来就落在合法区间的中间时，才值得试边界；已经在边界上的案例不重复造
  const leaf = path.split('.').pop().replace(/\[\]/g, '');
  const current = typeof given?.[leaf] === 'number' ? given[leaf] : null;
  if (current !== null && Number.isFinite(spec.max) && current > spec.max) return [];
  return probes;
}

function withRole(step, role) {
  const next = JSON.parse(JSON.stringify(step));
  next.as = role;
  return next;
}

/** 只保留到目标步为止的前缀：后面的步骤依赖前面成功，负例不该把它们拖进来。 */
function prefix(steps, index) {
  return steps.slice(0, index + 1).map((s) => JSON.parse(JSON.stringify(s)));
}

function candidate({ caseId, kind, step, index, expectation, hypotheses, confidence, basis, mutation, review }) {
  return {
    case_id: caseId,
    kind,
    capability: step.capability,
    as: step.as,
    step_index: index,
    step_id: step.id,
    expectation,
    hypotheses: hypotheses || null,
    confidence,
    status: 'disputed',
    basis,
    mutation,
    review,
    steps: null, // 由调用方填
  };
}

/**
 * @param {object} opts
 * @param {object} opts.case 已通过 validateCase 的案例
 * @param {object} opts.manifest 适配器清单（capabilities / roles）
 * @param {number} [opts.max] 每条案例的候选上限，防止爆炸
 * @returns {Array<object>} 候选，全部 status: 'disputed'
 */
export function deriveNegatives({ case: c, manifest, max = 40 }) {
  const caps = new Map((manifest?.capabilities || []).map((x) => [x.id, x]));
  const manifestRoles = Array.isArray(manifest?.roles) ? manifest.roles : [];
  const steps = c.reference_trajectory || [];
  const out = [];
  const seen = new Set();

  const push = (cand, stepsForCand) => {
    // 造不出合法轨迹（比如要改的路径在案例里根本没传）就不提这条候选：
    // 一条「改不动的负例」比没有负例更糟，它会被当成已覆盖。
    if (!stepsForCand) return;
    const key = `${cand.kind}|${cand.capability}|${cand.step_index}|${cand.mutation}`;
    if (seen.has(key) || out.length >= max) return;
    seen.add(key);
    // 候选的最后一步必须真的写着「期望被拒」，否则抄进案例时它还是个 applied，
    // 审阅表说要拒绝、轨迹说该成功 —— 这种自相矛盾比不生成更糟。
    const steps2 = stepsForCand.map((s, i) =>
      cand.expectation && i === stepsForCand.length - 1 ? { ...s, expected_outcome: cand.expectation } : s,
    );
    out.push({ ...cand, key: `${c.id}~${cand.kind}-${out.length + 1}`, steps: steps2 });
  };

  steps.forEach((step, index) => {
    const cap = caps.get(step.capability);
    if (!cap) return; // 清单里没有的能力不猜
    const declared = cap.args || {};
    const given = argsOf(step);

    // 1) 必填参数缺失
    for (const [name, type] of Object.entries(declared)) {
      if (isOptionalType(type)) continue;
      if (!(name in given)) continue; // 案例本来就没传，不是这条能造的负例
      push(
        candidate({
          caseId: c.id,
          kind: 'missing_required_arg',
          step,
          index,
          expectation: 'rejected',
          confidence: 'high',
          basis: `${cap.id}.args.${name} 声明为 ${type}（必填）`,
          mutation: `删掉 ${step.id}.${name}`,
          review: [
            '这个参数真的是必填，还是声明写严了？',
            '被拒之后有没有留下半条记录（要配 window 断言）？',
          ],
        }),
        [...prefix(steps, index - 1), dropArg(step, name)],
      );
    }

    // 2) 角色越权：清单里存在、但该能力不接受的��份
    const allowed = new Set(cap.roles || []);
    const outsiders = manifestRoles.filter((r) => !allowed.has(r) && r !== 'anonymous');
    if (allowed.size > 0 && outsiders.length > 0) {
      const role = outsiders[0];
      push(
        candidate({
          caseId: c.id,
          kind: 'role_violation',
          step,
          index,
          expectation: 'rejected',
          confidence: 'high',
          basis: `${cap.id}.roles=[${[...allowed].join(',')}]，${role} 不在其中`,
          mutation: `${step.id}.as: ${step.as} → ${role}`,
          review: [
            `换身份后接口返回的是 401/403，还是干脆 200 加空数据？后者是泄漏。`,
            '这条角色约束是不是只在 UI 层挡着？',
            `注意：如果 manifest.roles 里的 ${role} 是**身份别名**而不是角色（同一个 role 换个人），` +
              '这条会实测成 observed_accept —— 那是清单把「角色」和「身份」混成一栏，不是实现有洞。',
          ],
        }),
        [...prefix(steps, index - 1), withRole(step, role)],
      );
    }

    // 3) 类型不符：只对必填的标量参数做，避免把嵌套结构写歪
    for (const [name, type] of Object.entries(declared)) {
      if (isOptionalType(type)) continue;
      if (!(name in given)) continue;
      const bad = wrongTypeValue(type);
      if (bad === null) continue;
      push(
        candidate({
          caseId: c.id,
          kind: 'wrong_type',
          step,
          index,
          expectation: 'rejected',
          confidence: 'medium',
          basis: `${cap.id}.args.${name} 声明为 ${type}`,
          mutation: `${step.id}.${name} = ${JSON.stringify(bad)}`,
          review: [
            '服务端是返回 4xx，还是悄悄做类型转换（"12" 当成 12）？',
            '如果转换了，前端与后端的类型契约由谁保证？',
          ],
        }),
        [...prefix(steps, index - 1), setArg(step, name, bad)],
      );
    }

    // 3b) 声明的边界之外：min / max / integer / enum
    // 这一类不是猜的——约束就写在 manifest 里。工具能问出「qty=0」「qty=100」，
    // 是因为适配器自己声明了 1..99，而不是因为工具觉得数字应该有个范围。
    const constraints = cap.constraints || {};
    for (const [path, spec] of Object.entries(constraints)) {
      const probed = boundaryProbes(path, spec, given);
      for (const probe of probed) {
        push(
          candidate({
            caseId: c.id,
            kind: 'boundary_violation',
            step,
            index,
            expectation: 'rejected',
            confidence: 'high',
            basis: `${cap.id}.constraints[${JSON.stringify(path)}]=${JSON.stringify(spec)}，试 ${probe.label}`,
            mutation: `${step.id}.${path} = ${JSON.stringify(probe.value)}`,
            review: [
              `服务端真的按声明的边界拒绝吗？还是只在 UI 上限了？`,
              `被拒之后有没有留下半条记录（要配 window 断言）？`,
            ],
          }),
          [...prefix(steps, index - 1), setPathArg(step, path, probe.value)],
        );
      }
    }

    // 4) 不存在的实体
    for (const [name, type] of Object.entries(declared)) {
      if (isOptionalType(type)) continue;
      if (!looksLikeKey(name)) continue;
      const absent = absentValue(type);
      push(
        candidate({
          caseId: c.id,
          kind: 'unknown_entity',
          step,
          index,
          expectation: 'rejected',
          confidence: 'medium',
          basis: `${cap.id}.args.${name} 是主键类参数，声明为 ${type}`,
          mutation: `${step.id}.${name} = ${JSON.stringify(absent)}`,
          review: [
            '查不到时该 404 还是返回空集合？两者都常见，选一个写进契约。',
            '注意别把「查询不存在」和「越权访问存在」混成同一个响应。',
          ],
        }),
        [...prefix(steps, index - 1), setArg(step, name, absent)],
      );
    }

    // 5) 重复提交：只能提问，不能给答案
    if (WRITE_KIND.has(cap.kind)) {
      const again = JSON.parse(JSON.stringify(step));
      again.id = `${step.id}b`;
      push(
        candidate({
          caseId: c.id,
          kind: 'duplicate_submit',
          step,
          index,
          expectation: null,
          hypotheses: ['applied', 'rejected'],
          confidence: 'low',
          basis: `${cap.id} 是写操作；幂等与否属于业务决定，声明里没有`,
          mutation: `重复一次 ${step.id}（同参数、同身份）`,
          review: [
            '同一个请求发两次，第二次应该成功（幂等）还是拒绝（防重）？',
            '若幂等：两条记录还是一条？金额有没有被扣两次？',
            '若拒绝：返回 409 还是 422？错误体里给不给原单号？',
          ],
        }),
        [...prefix(steps, index), again],
      );
    }
  });

  return out;
}

/** 审阅表：人能直接勾的清单，不是判决。 */
/**
 * 把一条候选跑出来看：只记「实际发生了什么」，不记「应该是什么」。
 *
 * 这一步的价值在于分开三件常被混为一谈的事：
 *   - 期望被拒、实际也被拒  → observed_reject（声明与实现一致，可以进案例）
 *   - 期望被拒、实际成功了  → observed_accept（**实现有洞**，或声明写严了）
 *   - 两个实现给的结论不同   → diverged（契约本身没说清，先别写案例）
 *   - 跑不动（unknown）      → 不猜
 *
 * 判决仍然是 disputed：观察到的事实不是判据，进 cases/ 仍然要人 accept 署名。
 */
export function classifyObserved(verdictA, verdictB, expectation) {
  // 看的是**最后一步的结局**，不是整体判决。
  // 整体判决被案例自带的 goal 断言左右（负例本来就该让「订单数 >= 1」不成立），
  // 拿它分类等于在测「我把断言改坏了吗」，而不是「服务端拒没拒」。
  const lastOutcome = (v) => {
    const tr = v && v.evidence && Array.isArray(v.evidence.trace) ? v.evidence.trace : null;
    if (!tr || tr.length === 0) return null;
    const last = tr[tr.length - 1];
    return last && typeof last.outcome === 'string' ? last : null;
  };
  const a = lastOutcome(verdictA);
  const b = lastOutcome(verdictB);
  if (!a) {
    return { observed: 'unknown', detail: '跑不出结论（没有轨迹，或环境没起来）', a: null, b: b ? b.outcome : null };
  }
  if (b && a.outcome !== b.outcome) {
    return {
      observed: 'diverged',
      detail: `两个实现结论不同：A=${a.outcome}（${a.error?.code ?? '—'}），B=${b.outcome}（${b.error?.code ?? '—'}）`,
      a: a.outcome,
      b: b.outcome,
    };
  }
  const code = a.error?.code ? `（${a.error.code}）` : '';
  if (expectation === 'rejected') {
    return a.outcome === 'rejected'
      ? { observed: 'observed_reject', detail: `确实被拒了${code}`, a: a.outcome, b: b ? b.outcome : null }
      : { observed: 'observed_accept', detail: `期望被拒，实际 ${a.outcome}${code}`, a: a.outcome, b: b ? b.outcome : null };
  }
  if (expectation === 'applied') {
    return a.outcome === 'applied'
      ? { observed: 'observed_accept', detail: '确实执行了', a: a.outcome, b: b ? b.outcome : null }
      : { observed: 'observed_reject', detail: `期望成功，实际被拒${code}`, a: a.outcome, b: b ? b.outcome : null };
  }
  return {
    observed: a.outcome === 'applied' ? 'observed_accept' : 'observed_reject',
    detail: `没有预设期望，只记录实际结局 ${a.outcome}${code}（幂等与否属于业务决定）`,
    a: a.outcome,
    b: b ? b.outcome : null,
  };
}

/** 汇总：给审阅表用的三行结论。 */
export function formatObservedSummary(results) {
  const counts = new Map();
  let total = 0;
  for (const r of results) {
    for (const cand of r.candidates) {
      if (!cand.observed) continue;
      total += 1;
      const key = cand.observed.observed; // 分类结果是对象 {observed, detail, a, b}
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (total === 0) return '（没有跑过的候选：加 --run 才会实际执行）';
  const order = ['observed_reject', 'observed_accept', 'diverged', 'unknown'];
  const label = {
    observed_reject: '按期望被拒',
    observed_accept: '实际执行成功（实现有洞或声明写严了）',
    diverged: '两个实现结论不同',
    unknown: '跑不出结论',
  };
  const lines = [`实跑 ${total} 条候选：`];
  for (const k of order) {
    if (counts.has(k)) lines.push(`  ${label[k]}  ${counts.get(k)} 条（${k}）`);
  }
  return lines.join(String.fromCharCode(10));
}

export function renderNegativeSheet(caseId, candidates) {
  const lines = [];
  lines.push(`# 负例候选 · ${caseId}`);
  lines.push('');
  lines.push('> 全部 `status: disputed`。机器只按**声明**派生，不替你决定「应该允许什么」。');
  lines.push('> 确认后才写成案例并 `agent-web accept` 署名；本文件不会被判决读取。');
  lines.push('');
  if (candidates.length === 0) {
    lines.push('这条案例没有可派生的候选（能力未在清单里声明，或参数全是可选的）。');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`共 ${candidates.length} 条。勾掉不需要的，把剩下的 `+'`steps`'+` 抄进新案例。`);
  lines.push('');
  for (const cand of candidates) {
    const exp = cand.expectation === null
      ? `待定（${cand.hypotheses.join(' / ')}）`
      : cand.expectation;
    lines.push(`- [ ] \`${cand.kind}\` · ${cand.capability} · as=${cand.as} · 期望 **${exp}** · 置信 ${cand.confidence}`);
    if (cand.observed) {
      lines.push(`  - 实测：**${cand.observed.observed}** — ${cand.observed.detail}`);
    }
    lines.push(`  - 依据：${cand.basis}`);
    lines.push(`  - 改法：${cand.mutation}`);
    for (const r of cand.review) lines.push(`  - 待确认：${r}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** 控制台摘要。 */
export function formatNegativeSummary(results) {
  const total = results.reduce((n, r) => n + r.candidates.length, 0);
  const byKind = new Map();
  for (const r of results) {
    for (const c of r.candidates) byKind.set(c.kind, (byKind.get(c.kind) || 0) + 1);
  }
  const lines = [];
  lines.push(`负例候选 · ${results.length} 条案例 · ${total} 条候选（全部 disputed，未进判决）`);
  lines.push('');
  for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${kind.padEnd(22)} ${n}`);
  }
  if (byKind.size > 0) lines.push('');
  for (const r of results) {
    lines.push(`  ${r.case_id.padEnd(32)} ${String(r.candidates.length).padStart(3)} 条`);
  }
  return lines.join('\n');
}

/**
 * 落盘。默认写 `.agent-web/negatives/`，绝不写进案例目录——
 * 这一条是 L4 的边界，不是可选项。
 */
export function writeNegatives(outDir, results) {
  const abs = path.resolve(outDir);
  fs.mkdirSync(abs, { recursive: true });
  const written = [];
  for (const r of results) {
    const stem = String(r.case_id).replace(/[\\/]/g, '__');
    const jsonPath = path.join(abs, `${stem}.negatives.json`);
    const mdPath = path.join(abs, `${stem}.negatives.md`);
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          schema_version: 'agent-web/negatives/0.1',
          case_id: r.case_id,
          generated_from: r.source,
          note: '全部为 disputed 候选，未进判决；确认后由人改写成案例并 accept。',
          candidates: r.candidates,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    fs.writeFileSync(mdPath, renderNegativeSheet(r.case_id, r.candidates), 'utf8');
    written.push(jsonPath, mdPath);
  }
  return { dir: abs, files: written };
}

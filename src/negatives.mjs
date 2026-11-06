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

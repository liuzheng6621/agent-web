/**
 * draft —— 从一条真实轨迹反推案例草稿
 *
 * record 解决「轨迹从哪来」，draft 解决「案例从哪来」。中间这一步此前只能人肉做：
 * 盯着终态，一条条手写 field_equals，写完还得担心 id 是不是钉死在那次运行上。
 *
 * 三条纪律：
 *
 * 1) 草稿描述的是「实际发生了什么」，不是「应该发生什么」。
 *    因此回放必然 pass —— 这不是草稿对了，这是草稿同义反复。
 *    它的价值只在于把人要想的那部分，从「从零写」压到「几条待确认」。
 *    工具必须把这句话打在输出里，否则下一个人会把它当判据用。
 *
 * 2) 不生成它证不出来的东西。事件流水的条数依赖实现的事件粒度；
 *    多实体时挑哪一条当判据属于业务判断。这些一律进 todo，不猜。
 *    猜错一条，就是一条安静的假断言 —— 比少写一条危险得多。
 *
 * 3) 断言必须可移植。id / createTime / pickupNo 换一次 reset 就变，
 *    写进断言等于把案例钉死在这一场运行上。这类字段一律不生成。
 */

import { fingerprint, getPath, deepEqual } from './values.mjs';
import { selectEntities } from './select.mjs';
import { discoverRelations } from './relations.mjs';
import { SCHEMA_VERSION, resolveArguments, BindingError } from './case.mjs';
import { classifyStepOutcome } from './step-outcome.mjs';

/**
 * 环境相关字段：换一次 reset、换一个适配器就会变。
 * 注意 orderId / userId 这类以 Id 结尾的也在这里 —— 绑定表达式能处理它们，
 * 断言不能，断言里没有 $s1 这种语法。
 */
const ENV_FIELD = /^(id|.*Id|.*_id|createTime|createdAt|updateTime|updatedAt|at|by|pickupNo|username|token|password)$/;

/** 一条实体在集合里的稳定身份。没有 id 就退回语义指纹。 */
export function identityOf(row) {
  if (row && typeof row === 'object' && !Array.isArray(row) && row.id !== undefined) {
    return 'id:' + String(row.id);
  }
  return 'fp:' + fingerprint(row);
}

/** 该判「这条集合」的哪些字段。status 永远第一，其余按标量优先。 */
function rankFields(entity, origin) {
  const changed = [];
  for (const k of Object.keys(entity ?? {})) {
    if (ENV_FIELD.test(k)) continue;
    const v = entity[k];
    if (v === undefined) continue;
    if (origin && deepEqual(getPath(origin, k), v)) continue;
    changed.push(k);
  }
  const rank = (k) => {
    if (k === 'status') return 0;
    const v = entity[k];
    return v !== null && typeof v === 'object' ? 2 : 1;
  };
  return changed.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** 与 status_transition 求值器同一套语义：按 step.stateAfter 取序列，去连续重复。 */
function observedSequence(trace, spec, path = 'status') {
  const raw = [];
  for (const step of trace) {
    const sel = selectEntities(step.stateAfter, spec);
    if (sel.status !== 'ok' || sel.rows.length === 0) continue;
    const v = getPath(sel.rows[0], path);
    if (v === undefined) continue;
    raw.push(v);
  }
  return raw.filter((v, i) => i === 0 || v !== raw[i - 1]);
}

function listCollections(state, manifest) {
  const declared = manifest?.view?.collections;
  if (declared && Object.keys(declared).length > 0) {
    return Object.entries(declared)
      .filter(([, spec]) => spec.kind === 'list')
      .map(([name]) => name);
  }
  return Object.keys(state ?? {}).filter((k) => Array.isArray(state[k]));
}

function fieldNote(name, field, value) {
  const v = JSON.stringify(value);
  if (field === 'status') return `${name} 的 status 停在 ${v}（这是本次运行的终点，不代表它应该停在这里）`;
  if (value !== null && typeof value === 'object') return `${name}.${field} 按深比较写成 ${v}，改一处结构就会失效`;
  return `${name}.${field} 的终值是 ${v}；它是不是「应该的值」，需要人来确认`;
}

/**
 * 从初态、终态、逐步轨迹里合成断言。
 *
 * @returns {{ goal_assertions, invariants, notes, todo, summary }}
 */
export function synthesize({ initial, final, trace = [], manifest = {}, steps = [] }) {
  const goal = [];
  const invariants = [];
  const notes = [];
  const todo = [];
  const summary = [];
  const eventsScope = manifest?.events_scope ?? null;
  const collections = listCollections(final, manifest);

  const pushGoal = (assertion, why) => {
    goal.push(assertion);
    notes.push({ at: `goal[${goal.length - 1}]`, why });
    return goal.length - 1;
  };
  const pushInvariant = (assertion, why) => {
    invariants.push(assertion);
    notes.push({ at: `invariant[${invariants.length - 1}]`, why });
    return invariants.length - 1;
  };

  for (const name of collections) {
    const before = Array.isArray(getPath(initial, name)) ? getPath(initial, name) : [];
    const after = Array.isArray(getPath(final, name)) ? getPath(final, name) : [];
    const delta = after.length - before.length;
    summary.push({ collection: name, before: before.length, after: after.length, delta });

    // 事件流水：条数取决于实现记多细，断言条数等于把案例绑到某个实现的事件粒度上。
    if (name === eventsScope) {
      if (delta !== 0) {
        todo.push(
          `${name} 是事件流水（manifest.events_scope），本次新增 ${delta} 条，草稿不为它生成 count_delta：` +
            '条数依赖实现的事件粒度。要禁中间行为，用 event_absent；要判路径，用 status_transition。',
        );
      }
      continue;
    }

    if (delta !== 0) {
      pushGoal(
        { kind: 'count_delta', selector: { collection: name }, delta },
        `${name} 由 ${before.length} 条变成 ${after.length} 条（净变化 ${delta > 0 ? '+' : ''}${delta}）`,
      );
    }

    const beforeIds = new Set(before.map(identityOf));
    const afterIds = new Set(after.map(identityOf));
    const newRows = after.filter((r) => !beforeIds.has(identityOf(r)));
    const changedRows = after.filter((r) => beforeIds.has(identityOf(r)) && !deepEqual(
      before.find((b) => identityOf(b) === identityOf(r)),
      r,
    ));

    // 初态有、终态没了：只提示，不自动写断言。删除类行为的判据通常是
    // 「该删的删了、不该删的还在」，草稿只看得到「少了」，看不到「该不该少」。
    const goneRows = before.filter((r) => !afterIds.has(identityOf(r)));
    if (goneRows.length > 0) {
      todo.push(`${name} 有 ${goneRows.length} 条实体在终态消失，草稿不猜它们该不该消失；确认后自己写 entity_exists / count_delta`);
    }

    if (newRows.length > 1) {
      todo.push(
        `${name} 本次新增 ${newRows.length} 条，草稿不替你挑哪一条是判据对象；` +
          '请用 where 谓词或 index 手写 selector，再补 field_equals。',
      );
      continue;
    }

    const focus = newRows[0] ?? changedRows[0] ?? null;
    if (focus === null) {
      // 整条集合一点没动。这类集合通常属于「Agent 本来就不该碰」，
      // 所以进 invariants 而不是 goal_assertions —— 语义是「全程不许动」，不是「目标达成」。
      if (before.length > 0) {
        pushInvariant(
          { kind: 'unchanged', scopes: [name] },
          `${name} 全程未变（${before.length} 条），按「Agent 不该碰它」写成不变量；若它本来就该变，删掉这条`,
        );
      }
      continue;
    }

    const idx = after.indexOf(focus);
    const isNew = newRows.length === 1;

    // 首次观测到的快照：新实体取它刚出现时那一步的 stateAfter。
    let origin = null;
    for (const step of trace) {
      const rows = Array.isArray(getPath(step.stateAfter, name)) ? getPath(step.stateAfter, name) : [];
      const hit = rows.find((r) => identityOf(r) === identityOf(focus));
      if (hit) { origin = hit; break; }
    }

    const fields = rankFields(focus, origin).slice(0, 4);
    if (fields.length === 0) {
      todo.push(`${name}#${idx} 的字段在本次运行里没有任何变化，草稿没有可写的 field_equals；若它本就该停在这个状态，手写一条把意图写明`);
    }
    for (const f of fields) {
      pushGoal(
        { kind: 'field_equals', selector: { collection: name, index: idx }, path: f, value: focus[f] },
        fieldNote(name, f, focus[f]) + (isNew ? '' : `（这条实体初态已存在，终态被改动）`),
      );
    }

    // 状态迁移：用与求值器完全相同的取序列方式，保证草稿可重放。
    if (focus.status !== undefined) {
      const spec = { collection: name, index: idx };
      const seq = observedSequence(trace, spec, 'status');
      if (seq.length >= 2) {
        const transitions = [];
        for (let i = 1; i < seq.length; i += 1) {
          if (seq[i - 1] !== seq[i]) transitions.push([seq[i - 1], seq[i]]);
        }
        if (transitions.length > 0) {
          pushGoal(
            { kind: 'status_transition', selector: spec, path: 'status', transitions },
            `${name}#${idx} 实际走了 ${seq.join(' -> ')}；transitions 只要求「出现过这些边」，不要求顺序也不要求全部路径`,
          );
        }
      } else if (seq.length === 1) {
        todo.push(`${name}#${idx} 的 status 在轨迹里只观测到 ${JSON.stringify(seq[0])} 一个值，写不出 status_transition；需要的话补一条「中途必须经过某态」的断言`);
      }
    }

    if (idx !== 0) {
      notes.push({ at: `selector ${name}#${idx}`, why: '用下标定位；若被测系统的集合顺序不稳定，改成 where 谓词' });
    }
  }

  // 关系型断言：字段之间的关系比字段的具体值更耐移植，也更难被「碰巧正确」蒙过。
  // 只提议在这条轨迹上已经成立的关系；置信度低的进 todo，让人自己决定要不要。
  const relations = discoverRelations({ initial, final, manifest });
  const weak = [];
  for (const r of relations) {
    if (r.confidence === 'structural') {
      pushGoal(r.assertion, `${r.why} —— 关系式，比写死具体值更耐移植`);
    } else {
      weak.push(r);
    }
  }
  for (const r of weak) {
    pushGoal(
      r.assertion,
      `${r.why} —— 但这条轨迹只有 1 条明细或数量为 1，此时它几乎恒真：` +
        '「漏乘数量」「少算一项」都会碰巧满足。补一条「两种饮品、数量大于 1」的订单，它才算真正在测东西',
    );
    todo.push(
      `关系式 ${JSON.stringify(r.assertion)} 目前在 ${r.sample} 上成立，但区分力不足；` +
        '补一条多明细、数量大于 1 的案例，或确认后删掉这条断言',
    );
  }

  // 读操作占了轨迹但没写断言：提醒一句，免得人以为草稿漏了。
  const writeCaps = new Set(
    (manifest?.capabilities ?? []).filter((c) => c.kind === 'write').map((c) => c.id),
  );
  const usedReads = [...new Set(steps.map((s) => s.capability).filter((c) => !writeCaps.has(c)))];
  if (usedReads.length > 0) {
    notes.push({
      at: 'allowed_capabilities',
      why: `轨迹里用了读操作 ${usedReads.join(', ')}；读操作不是被判的动作，只用来摸 id，默认不进白名单`,
    });
  }

  todo.push(
    '草稿的断言全部从「实际发生」反推，回放必然 pass —— 它描述现状，不表达应该。' +
      '逐条确认：这个值是不是「应该的值」，不是就改掉。',
  );
  todo.push(
    '至少补一条负例：越权、非法状态迁移、重复提交应当被拒（expected_outcome: rejected）。' +
      '只有正例的案例永远绿，等于没测。',
  );
  todo.push(
    'allowed_capabilities 目前照抄轨迹里用到的写操作；判据应该是「应该允许」而不是「实际用了」。多一条就是放水。',
  );
  if (steps.some((s) => s.expected_outcome === 'rejected')) {
    notes.push({
      at: 'allowed_capabilities',
      why:
        '轨迹里有负例步（expected_outcome: rejected）。白名单必须包含它，否则 runner 在调用适配器之前就判 invalid_action，' +
        '这一步永远测不到「系统拒绝它」——负例被自己的白名单挡在了门外。',
    });
  }
  todo.push('确认后删掉 draft 字段，把 status 从 unconfirmed 拿掉，这条案例才算接手。');

  return { goal_assertions: goal, invariants, notes, todo, summary };
}

/** 从轨迹回放一次，拿到初态 / 终态 / 逐步轨迹。语义与 runner 保持一致。 */
export async function replayTrajectory({ adapter, steps, scopes, seed, clockPolicy, snapshotRef }) {
  const reset = await adapter.reset({ seed, clockPolicy, snapshotRef });
  const runId = reset.runId;
  const trace = [];
  try {
    const first = await adapter.observe(runId, scopes);
    const initial = first?.state ?? null;
    if (initial === null) {
      return { ok: false, aborted: { code: 'missing_observation', detail: '复位后无法观测初态' }, initial: null, final: null, trace, roleBindings: reset.roleBindings };
    }

    const outputs = new Map();
    let aborted = null;
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      let args;
      try {
        args = resolveArguments(step, outputs);
      } catch (e) {
        if (e instanceof BindingError) {
          aborted = { code: 'invalid_action', at: i, detail: '参数绑定失败：' + e.message };
          break;
        }
        throw e;
      }

      const before = await adapter.observe(runId, scopes);
      const res = await adapter.execute(runId, { capability: step.capability, arguments: args, as: step.as });
      const after = await adapter.observe(runId, scopes);

      trace.push({
        index: i,
        id: step.id,
        capability: step.capability,
        as: step.as ?? null,
        arguments: args,
        expected_outcome: step.expected_outcome,
        outcome: res.outcome,
        payload: res.payload ?? null,
        error: res.error ?? null,
        stateBefore: before?.state ?? null,
        stateAfter: after?.state ?? null,
      });

      // 分类语义与判决路径共用一份实现（src/step-outcome.mjs）。
      // 这里曾经是 runner 那段 if 链的手抄副本，runner 修好了它没修 —— 于是同一个洞
      // 在录制路径上又活了一个版本。抄一遍就是埋一次。
      const cls = classifyStepOutcome({ res, step, index: i, verb: '录' });
      if (cls) {
        aborted = cls;
        break;
      }

      if (res.outcome === 'applied') outputs.set(step.id, res.payload ?? null);
    }

    const last = await adapter.observe(runId, scopes);
    return {
      ok: aborted === null,
      aborted,
      initial,
      final: last?.state ?? null,
      trace,
      roleBindings: reset.roleBindings,
    };
  } finally {
    try {
      await adapter.close(runId);
    } catch {
      /* 释放失败不覆盖回放结果 */
    }
  }
}

/** 把回放结果拼成一条能直接跑的案例。 */
export function buildDraftCase({
  id,
  adapterName,
  seed,
  source,
  steps,
  initial,
  final,
  trace,
  manifest,
  scopes,
  goal,
  now = new Date().toISOString(),
}) {
  const synth = synthesize({ initial, final, trace, manifest, steps });
  // 白名单要连被拒绝的步一起收：runner 在调用适配器之前先查白名单，
  // 少写一条，负例会在「系统拒绝它」之前就被判成 invalid_action，
  // 于是这条案例永远测不到它想测的那个越权。
  const usedCaps = [...new Set(steps.map((s) => s.capability))];

  const c = {
    schema_version: SCHEMA_VERSION,
    id,
    environment: { adapter: adapterName, seed: seed ?? {} },
    task: {
      natural_goal: goal || `（待补）由 ${source} 还原，请用一句话写清 Agent 要达成的业务目标。`,
      allowed_capabilities: usedCaps,
      goal_assertions: synth.goal_assertions,
      invariants: synth.invariants,
    },
    reference_trajectory: steps,
    observability: { declared_scopes: scopes },
    draft: {
      status: 'unconfirmed',
      generated_by: 'agent-web draft',
      generated_at: now,
      from: source,
      initial_fingerprint: fingerprint(initial),
      final_fingerprint: fingerprint(final),
      collections: synth.summary,
      notes: synth.notes,
      todo: synth.todo,
    },
  };

  return { case: c, synth };
}

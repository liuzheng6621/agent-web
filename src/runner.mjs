/**
 * 判决协议。
 *
 * 顺序是固定的六步，任何一步中止都要留下「在哪一步、为什么」：
 *   1 校验案例与环境
 *   2 复位到初态，检查初态前置条件
 *   3 逐步执行，记录每步的前后状态与实际结果
 *   4 分类：业务拒绝 / 覆盖缺口 / 基础设施故障，三者的 verdict 完全不同
 *   5 求值目标与不变量
 *   6 释放运行资源（无论成败）
 *
 * 一条纪律：判不了的记为 unknown，且留在分母里。
 * 把 unknown 从统计里踢掉，是这类系统最常见的自欺方式。
 */

import { validateCase, validateSteps, resolveArguments, deriveLabels, BindingError, draftBlocker } from './case.mjs';
import { validateManifest, OUTCOMES } from './adapter/contract.mjs';
import { checkStateAgainstView } from './view.mjs';
import { evalAssertions, firstFailure, TRUE, FALSE, UNKNOWN } from './assert/index.mjs';
import { getPath } from './values.mjs';

export const VERDICTS = Object.freeze(['pass', 'fail', 'unknown']);

/**
 * 断言层比判决层更清楚「为什么不知道」的几种情况。
 * 只有落在这一张白名单里，才会被提到 verdict.reason_code 上；
 * 其余一律退回缺省的 missing_observation，避免把细节代码变成随手可加的口子。
 */
const SPECIFIC_UNKNOWN_CODES = new Set(['unsupported_event']);

function makeVerdict(base, status, reason_code, extra = {}) {
  return {
    ...base,
    status,
    reason_code,
    ...extra,
    finished_at: new Date().toISOString(),
  };
}

async function observeState(adapter, runId, scopes) {
  const r = await adapter.observe(runId, scopes);
  return {
    state: r?.state ?? null,
    missingScopes: r?.missingScopes ?? [],
  };
}

function eventContext(state, manifest) {
  const scope = manifest.events_scope;
  const events = scope ? getPath(state, scope) : undefined;
  const vocabulary = Array.isArray(manifest.events_types) ? manifest.events_types : null;
  if (!Array.isArray(events)) return { events: [], eventsComplete: false, eventsVocabulary: vocabulary };
  return { events, eventsComplete: manifest.events_complete === true, eventsVocabulary: vocabulary };
}

async function judgeInner({ case: c, adapter, adapterName = 'unknown', trajectory = null }) {
  const startedAt = Date.now();
  const base = {
    case_id: c?.id ?? '<invalid>',
    adapter: adapterName,
  };

  // 候选轨迹优先：有它就判它，没有才判案例自带的参考轨迹。
  // judge 因此能判任何 Agent 的实际动作序列，而不只是人写的样本。
  const candidate = Array.isArray(trajectory) ? trajectory : null;
  const steps = candidate ?? c?.reference_trajectory;
  base.trajectory_source = candidate ? 'candidate' : 'reference';

  const caseErrors = validateCase(c);
  if (candidate) {
    const stepErrors = validateSteps(candidate, 'trajectory');
    if (stepErrors.length > 0) {
      return makeVerdict(base, 'unknown', 'invalid_case', {
        detail: '候选轨迹未通过结构校验，不进入执行',
        errors: stepErrors,
        timing_ms: Date.now() - startedAt,
      });
    }
  }
  if (caseErrors.length > 0) {
    return makeVerdict(base, 'unknown', 'invalid_case', {
      detail: '案例未通过格式校验，不进入执行',
      errors: caseErrors,
      timing_ms: Date.now() - startedAt,
    });
  }

  // 草稿闸门：draft.status 仍是 unconfirmed 的案例，是机器生成、还没人看过的东西。
  // 让它进判决，等于让一张没人核对过的考卷冒充考卷 —— 所以判 unknown，不给分。
  const draftBlock = draftBlocker(c);
  if (draftBlock) {
    return makeVerdict(base, 'unknown', 'unconfirmed_draft', {
      detail: draftBlock.detail,
      timing_ms: Date.now() - startedAt,
    });
  }

  let manifest;
  try {
    manifest = await adapter.manifest();
  } catch (e) {
    return makeVerdict(base, 'unknown', 'infrastructure_error', {
      detail: `manifest() 抛错：${e && e.message}`,
      timing_ms: Date.now() - startedAt,
    });
  }

  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) {
    return makeVerdict(base, 'unknown', 'invalid_environment', {
      detail: '适配器 manifest 未通过校验',
      errors: manifestErrors,
      timing_ms: Date.now() - startedAt,
    });
  }

  base.adapter = manifest.adapter;
  base.adapter_version = manifest.adapter_version;
  base.labels = deriveLabels(c, manifest);

  const scopes = c.observability?.declared_scopes ?? manifest.scopes;

  let runId = null;
  try {
    const reset = await adapter.reset({
      seed: c.environment?.seed,
      clockPolicy: c.environment?.clock_policy,
      snapshotRef: c.environment?.snapshot_ref,
    });
    runId = reset.runId;

    // 角色 → 身份必须是单射。两个角色指向同一个真实身份，等于允许案例互相顶替，
    // 判决会变成 pass 而实际测的是另一个人的行为（见 docs/FINDING-001.md）。
    const roleBindings = reset.roleBindings;
    if (roleBindings && typeof roleBindings === 'object') {
      const seen = new Map();
      for (const [role, identity] of Object.entries(roleBindings)) {
        if (identity === null || identity === undefined) continue;
        const key = String(identity);
        if (seen.has(key)) {
          return makeVerdict(base, 'unknown', 'invalid_environment', {
            detail: '角色 ' + seen.get(key) + ' 与 ' + role + ' 指向同一身份 ' + key + '，身份隔离已失效',
            timing_ms: Date.now() - startedAt,
          });
        }
        seen.set(key, role);
      }
    }

    const first = await observeState(adapter, runId, scopes);
    const state0 = first.state;
    if (state0 === null) {
      return makeVerdict(base, 'unknown', 'missing_observation', {
        detail: '复位后无法观测初态',
        timing_ms: Date.now() - startedAt,
      });
    }

    // 视图契约：适配器声明了就必须满足。这一条要和「集合里没有实体」分开——
    // 前者是适配器没按约定投影（仪器问题），后者是被测系统真的没有数据（业务事实）。
    // 混在一起会让"我接错字段了"看起来像"这个系统什么都没有"。
    const viewCheck = checkStateAgainstView(state0, manifest.view);
    if (!viewCheck.ok) {
      return makeVerdict(base, 'unknown', 'invalid_environment', {
        detail: `观测结果不满足视图契约：${viewCheck.errors[0].detail}`,
        view_errors: viewCheck.errors,
        timing_ms: Date.now() - startedAt,
      });
    }

    // ---- step 2: 初态前置条件 ----
    const pre = evalAssertions(c.task.preconditions ?? [], {
      initial: state0,
      final: state0,
      trace: [],
      events: [],
      eventsComplete: false,
      missingScopes: first.missingScopes,
    });
    if (pre.status === FALSE) {
      return makeVerdict(base, 'unknown', 'invalid_initial_state', {
        detail: `初态不满足前置条件：${firstFailure(c.task.preconditions, pre.results).message}`,
        failed_assertions: pre.results.filter((r) => r.status !== TRUE),
        timing_ms: Date.now() - startedAt,
      });
    }
    if (pre.status === UNKNOWN) {
      return makeVerdict(base, 'unknown', 'missing_observation', {
        detail: '初态前置条件无法求值（观测不足）',
        failed_assertions: pre.results.filter((r) => r.status !== TRUE),
        timing_ms: Date.now() - startedAt,
      });
    }

    // ---- step 3: 逐步执行 ----
    const capById = new Map(manifest.capabilities.map((x) => [x.id, x]));
    const allowed = c.task.allowed_capabilities;
    const outputs = new Map();
    const trace = [];
    let aborted = null;

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const cap = capById.get(step.capability);
      if (!cap) {
        aborted = { status: 'unknown', code: 'coverage_gap', at: i, detail: `能力 ${step.capability} 不在 manifest` };
        break;
      }
      if (Array.isArray(allowed) && !allowed.includes(step.capability)) {
        aborted = { status: 'fail', code: 'invalid_action', at: i, detail: `能力 ${step.capability} 不在 allowed_capabilities` };
        break;
      }

      let args;
      try {
        args = resolveArguments(step, outputs);
      } catch (e) {
        if (e instanceof BindingError) {
          aborted = { status: 'fail', code: 'invalid_action', at: i, detail: `参数绑定失败：${e.message}` };
          break;
        }
        throw e;
      }

      const before = await observeState(adapter, runId, scopes);
      const res = await adapter.execute(runId, {
        capability: step.capability,
        arguments: args,
        as: step.as,
      });
      const after = await observeState(adapter, runId, scopes);

      trace.push({
        index: i,
        id: step.id,
        capability: step.capability,
        as: step.as ?? null,
        arguments: args,
        expected_outcome: step.expected_outcome,
        outcome: res.outcome,
        // 适配器愿意报就记：事后唯一能查「谁真的执行了这一步」的凭据。
        identity: res.identity ?? null,
        payload: res.payload ?? null,
        error: res.error ?? null,
        stateBefore: before.state,
        stateAfter: after.state,
      });

      // ---- step 4: 结果分类 ----
      // 契约外的 outcome 必须先被拦下。适配器返回 'success' / 'ok' / 拼错的 'applied '
      // 时，下面每一条 if 都不命中，于是这一步既不算失败也不算 unknown ——
      // 它会一路滑到终态断言，而终态断言可能正好成立，判决就 pass 了。
      // 这不是适配器写错，这是**判定权威被悄悄换掉**：验的不再是「这一步做成了」，
      // 而是「这一步没被拦下」。所以按 infra_error 处理，不按 rejected 处理。
      if (!OUTCOMES.includes(res.outcome)) {
        aborted = {
          status: 'unknown',
          code: 'contract_violation',
          at: i,
          detail: `适配器返回了契约外的 outcome ${JSON.stringify(res.outcome)}，`
            + `只认 ${OUTCOMES.join(' / ')}。这一步到底做成了没有，无法判断`,
        };
        break;
      }
      if (res.outcome === 'unsupported') {
        aborted = { status: 'unknown', code: 'coverage_gap', at: i, detail: `适配器演不了 ${step.capability}` };
        break;
      }
      if (res.outcome === 'infra_error') {
        aborted = { status: 'unknown', code: 'infrastructure_error', at: i, detail: res.error?.message ?? '适配器故障' };
        break;
      }
      // 「可能已经生效」与「没发生」是两条相反的重放指令，必须分开报。
      // 判 unknown 是一样的（看不见结果），但理由码不同：
      // infrastructure_error 说「可以重试」，effect_uncertain 说「不许重试，先去看状态」。
      // 合成一个码，重放器只能猜，猜错就是把已经扣了的钱再扣一次。
      if (res.outcome === 'may_have_committed') {
        aborted = {
          status: 'unknown',
          code: 'effect_uncertain',
          at: i,
          detail: `${step.capability} 可能已经生效但结果没回来`
            + `（${[res.error?.code, res.error?.message].filter(Boolean).join(' ') || '适配器未给原因'}）`
            + '：这一步不许重放，先观测再决定',
        };
        break;
      }
      if (step.expected_outcome === 'applied' && res.outcome === 'rejected') {
        aborted = {
          status: 'fail',
          code: 'unexpected_rejection',
          at: i,
          detail: `${step.capability} 被拒绝：${res.error?.code} ${res.error?.message}`,
        };
        break;
      }
      if (step.expected_outcome === 'rejected' && res.outcome === 'applied') {
        aborted = { status: 'fail', code: 'expected_rejection', at: i, detail: `${step.capability} 应被拒绝，实际被执行` };
        break;
      }

      if (res.outcome === 'applied') outputs.set(step.id, res.payload ?? null);
    }

    const last = await observeState(adapter, runId, scopes);
    const final = last.state;

    // 终态也过一次契约：初态合规、终态结构漂移，是适配器最容易出错的地方
    // （比如列表接口返回空时把数组换成了 null 或 {}）。
    const finalViewCheck = checkStateAgainstView(final, manifest.view);
    if (!finalViewCheck.ok) {
      return makeVerdict(base, 'unknown', 'invalid_environment', {
        detail: `终态观测不满足视图契约：${finalViewCheck.errors[0].detail}`,
        view_errors: finalViewCheck.errors,
        timing_ms: Date.now() - startedAt,
      });
    }

    const ctx = {
      initial: state0,
      final,
      trace,
      missingScopes: last.missingScopes,
      ...eventContext(final, manifest),
    };

    const goals = evalAssertions(c.task.goal_assertions, ctx);
    const invariants = evalAssertions(c.task.invariants ?? [], ctx);

    const evidence = {
      initial: state0,
      final,
      trace: trace.map((t) => ({
        index: t.index,
        id: t.id,
        capability: t.capability,
        as: t.as,
        // 参数要留在证据里：`report --counts` 靠它区分「重读同一个东西」与「读了两样东西」，
        // 也靠它认「先建后撤」这种白做的写。留空的话事后只能重跑才能数。
        arguments: t.arguments,
        expected_outcome: t.expected_outcome,
        outcome: t.outcome,
        identity: t.identity ?? null,
        error: t.error,
      })),
      events: ctx.events,
      events_complete: ctx.eventsComplete,
      missing_scopes: last.missingScopes,
      // 判决要能离线复查：把「这局的身份映射」和「这台环境的观测能力」
      // 一起留在证据里，否则事后只能靠重跑才能判断判决有没有被骗。
      role_bindings: reset.roleBindings ?? null,
      environment: {
        roles: Array.isArray(manifest.roles) ? [...manifest.roles] : null,
        scopes: Array.isArray(manifest.scopes) ? [...manifest.scopes] : null,
        events_complete: manifest.events_complete === true,
        events_types: Array.isArray(manifest.events_types) ? [...manifest.events_types] : null,
        reset_strategy: manifest.reset_strategy ?? null,
      },
    };

    // ---- step 5: 汇总 ----
    if (aborted) {
      return makeVerdict(base, aborted.status, aborted.code, {
        detail: aborted.detail,
        stage: `step[${aborted.at}]`,
        goal_results: goals.results,
        invariant_results: invariants.results,
        failed_assertions: [...goals.results, ...invariants.results].filter((r) => r.status !== TRUE),
        evidence,
        timing_ms: Date.now() - startedAt,
      });
    }

    if (goals.status === FALSE) {
      const f = firstFailure(c.task.goal_assertions, goals.results);
      return makeVerdict(base, 'fail', 'assertion_false', {
        detail: `目标未达成：${f.message}`,
        stage: 'goal',
        goal_results: goals.results,
        invariant_results: invariants.results,
        failed_assertions: [...goals.results, ...invariants.results].filter((r) => r.status !== TRUE),
        evidence,
        timing_ms: Date.now() - startedAt,
      });
    }
    if (invariants.status === FALSE) {
      const f = firstFailure(c.task.invariants, invariants.results);
      return makeVerdict(base, 'fail', 'invariant_violated', {
        detail: `不变量被打破：${f.message}`,
        stage: 'invariant',
        goal_results: goals.results,
        invariant_results: invariants.results,
        failed_assertions: [...goals.results, ...invariants.results].filter((r) => r.status !== TRUE),
        evidence,
        timing_ms: Date.now() - startedAt,
      });
    }
    if (goals.status === UNKNOWN || invariants.status === UNKNOWN) {
      const bad = [...goals.results, ...invariants.results].filter((r) => r.status === UNKNOWN);
      const codes = [...new Set(bad.map((r) => r && r.code).filter(Boolean))];
      // 全都因为同一个原因判不了时，把断言层那个更精确的代码提上来：
      // 「后端不记录这类事件」和「观测是空的」是两件不同的事，
      // 前者要改适配器，后者要补观测，混成一个代码就没人能据此行动。
      const reason = codes.length === 1 && SPECIFIC_UNKNOWN_CODES.has(codes[0]) ? codes[0] : 'missing_observation';
      return makeVerdict(base, 'unknown', reason, {
        detail: reason === 'unsupported_event'
          ? '存在无法求值的断言：实现未记录该类型事件'
          : '存在无法求值的断言（观测不足，既未通过也未失败）',
        stage: 'goal',
        goal_results: goals.results,
        invariant_results: invariants.results,
        failed_assertions: [...goals.results, ...invariants.results].filter((r) => r.status !== TRUE),
        evidence,
        timing_ms: Date.now() - startedAt,
      });
    }

    return makeVerdict(base, 'pass', 'ok', {
      detail: '目标与不变量全部成立',
      stage: 'goal',
      goal_results: goals.results,
      invariant_results: invariants.results,
      failed_assertions: [],
      evidence,
      timing_ms: Date.now() - startedAt,
    });
  } catch (e) {
    return makeVerdict(base, 'unknown', 'infrastructure_error', {
      detail: `未捕获异常：${e && e.message}`,
      stack: e && e.stack ? String(e.stack).split('\n').slice(0, 5) : undefined,
      timing_ms: Date.now() - startedAt,
    });
  } finally {
    // ---- step 6: 无论成败都释放 ----
    if (runId !== null) {
      try {
        await adapter.close(runId);
      } catch {
        /* 释放失败不覆盖判决 */
      }
    }
  }
}

/**
 * 外层包装只负责一件事：给单条案例一个硬上限。
 * 适配器卡住时必须有判决，宁可 unknown 也不能让整批跑挂死。
 */
export async function judge(opts) {
  const timeoutMs = Number(opts.timeoutMs ?? 0);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return judgeInner(opts);

  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true }), timeoutMs);
  });
  const result = await Promise.race([judgeInner(opts), timeout]);
  if (timer) clearTimeout(timer);

  if (result && result.__timedOut) {
    return makeVerdict(
      { case_id: opts.case?.id ?? '<invalid>', adapter: opts.adapterName ?? 'unknown' },
      'unknown',
      'infrastructure_error',
      { detail: '单条案例超时（>' + timeoutMs + 'ms），判决记为 unknown', timing_ms: timeoutMs },
    );
  }
  return result;
}

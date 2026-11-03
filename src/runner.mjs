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

import { validateCase, resolveArguments, deriveLabels, BindingError } from './case.mjs';
import { validateManifest } from './adapter/contract.mjs';
import { checkStateAgainstView } from './view.mjs';
import { evalAssertions, firstFailure, TRUE, FALSE, UNKNOWN } from './assert/index.mjs';
import { getPath } from './values.mjs';

export const VERDICTS = Object.freeze(['pass', 'fail', 'unknown']);

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
  if (!Array.isArray(events)) return { events: [], eventsComplete: false };
  return { events, eventsComplete: manifest.events_complete === true };
}

export async function judge({ case: c, adapter, adapterName = 'unknown' }) {
  const startedAt = Date.now();
  const base = {
    case_id: c?.id ?? '<invalid>',
    adapter: adapterName,
  };

  const caseErrors = validateCase(c);
  if (caseErrors.length > 0) {
    return makeVerdict(base, 'unknown', 'invalid_case', {
      detail: '案例未通过格式校验，不进入执行',
      errors: caseErrors,
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

    for (let i = 0; i < c.reference_trajectory.length; i += 1) {
      const step = c.reference_trajectory[i];
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
        payload: res.payload ?? null,
        error: res.error ?? null,
        stateBefore: before.state,
        stateAfter: after.state,
      });

      // ---- step 4: 结果分类 ----
      if (res.outcome === 'unsupported') {
        aborted = { status: 'unknown', code: 'coverage_gap', at: i, detail: `适配器演不了 ${step.capability}` };
        break;
      }
      if (res.outcome === 'infra_error') {
        aborted = { status: 'unknown', code: 'infrastructure_error', at: i, detail: res.error?.message ?? '适配器故障' };
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
        expected_outcome: t.expected_outcome,
        outcome: t.outcome,
        error: t.error,
      })),
      events: ctx.events,
      events_complete: ctx.eventsComplete,
      missing_scopes: last.missingScopes,
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
      return makeVerdict(base, 'unknown', 'missing_observation', {
        detail: '存在无法求值的断言（观测不足，既未通过也未失败）',
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

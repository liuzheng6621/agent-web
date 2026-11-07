// 展品 07：适配器说了个契约外的 outcome，判决照样 pass。
//
// 症状：把 execute 的返回值改成 'success'——一个在任何文档里都不存在、
// 但读起来完全合理的词——整条案例仍然 pass，理由码 ok，
// 详情「目标与不变量全部成立」。
//
// 机制：旧版 runner 的 step 4 是一串 if ——
//   unsupported / infra_error / 应拒却成 / 应成却拒
// 四个分支都不命中时，代码继续往下走：这一步既不算失败也不算 unknown，
// 它会一路滑到终态断言。而终态断言只问「最后有没有这张订单」，
// 那件事确实发生了——所以判决是对的，只是它回答的不是「这一步做成了没有」。
//
// 这不是适配器写错，是**判定权威被悄悄换掉**：验的不再是契约，
// 而是「这个值恰好没被任何分支拦下」。一个拼错的 'applied '（尾空格）、
// 一个大写 'APPLIED'、一个更诚实的 'ok'，全都能过。
//
// 抓住它的是 v0.60.0 加的两处：runner 的 OUTCOMES 白名单（contract_violation）
// 与 probe 的第 6 项（outcome-contract）。
//
// naive 的复现方式说明：这个 bug 已经被修在 runner 里了，没法再让当前 runner
// 走回旧路径。所以 naive 由**本地复刻旧 step-4 分支链**得出——不是猜测，
// 是把那四个 if 原样抄一遍跑同一份适配器。注释里逐条标出。
import { judge } from '../../src/runner.mjs';
import { probeAdapter } from '../../src/probe.mjs';
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';
import { evalAssertions, TRUE } from '../../src/assert/index.mjs';

export const meta = {
  id: 'e07-contract-violation',
  title: '适配器说了个契约外的 outcome，判决照样 pass',
  symptom: '整条案例 pass，理由码 ok；而那一步到底做成了没有，从来没被验证过',
  mechanism: '旧 step-4 的四个分支都不命中时这一步不中止 · 新增 OUTCOMES 白名单拦在分类之前',
  naive: 'pass',
  caught: 'unknown',
  caughtCode: 'contract_violation',
};

const CASE = {
  schema_version: 'agent-web/0.1',
  id: 'museum/e07',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '下一单',
    goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'orders' } }],
  },
  reference_trajectory: [
    {
      id: 's1',
      capability: 'order.create',
      as: 'customer',
      expected_outcome: 'applied',
      arguments: { items: [{ dishName: '拿铁', qty: 1 }] },
    },
  ],
  observability: { declared_scopes: ['orders', 'menu'] },
};

/** 只把 outcome 换成契约外的值，别的行为一概不动。 */
function offContract(outcome) {
  const inner = createMemoryAdapter();
  return {
    ...inner,
    async execute(runId, action) {
      const res = await inner.execute(runId, action);
      return { ...res, outcome };
    },
  };
}

/**
 * 旧版 step-4 分支链的本地复刻。
 *
 * 与 src/runner.mjs 修改前逐条对应：
 *   if (outcome === 'unsupported') 中止
 *   if (outcome === 'infra_error') 中止
 *   if (期望 applied && outcome === 'rejected') 中止
 *   if (期望 rejected && outcome === 'applied') 中止
 *   ——'success' 一条都不命中，于是不中止，直接求值终态断言。
 */
async function legacyNaive() {
  const adapter = offContract('success');
  const runId = (await adapter.reset({})).runId;
  const initial = (await adapter.observe(runId)).state;
  const res = await adapter.execute(runId, {
    capability: 'order.create',
    arguments: CASE.reference_trajectory[0].arguments,
    as: 'customer',
  });
  const final = (await adapter.observe(runId)).state;

  const aborted =
    res.outcome === 'unsupported'
    || res.outcome === 'infra_error'
    || (CASE.reference_trajectory[0].expected_outcome === 'applied' && res.outcome === 'rejected')
    || (CASE.reference_trajectory[0].expected_outcome === 'rejected' && res.outcome === 'applied');
  await adapter.close(runId);
  if (aborted) return { status: 'unknown', reason_code: 'aborted' };

  const evaluated = evalAssertions(CASE.task.goal_assertions, {
    initial, final, trace: [], events: [], eventsComplete: false,
  });
  const allTrue = evaluated.results.every((r) => r.status === TRUE);
  return { status: allTrue ? 'pass' : 'fail', reason_code: allTrue ? 'ok' : 'assertion_false' };
}

export async function run() {
  const naive = await legacyNaive();
  const caught = await judge({ case: CASE, adapter: offContract('success'), adapterName: 'memory' });

  // 第二道闸：即使有人把 runner 的白名单改回去，probe 也必须独立报出来。
  const p = await probeAdapter({ adapter: offContract('ok'), adapterName: 'memory' });
  const probeCheck = p.checks.find((c) => c.id === 'outcome-contract');
  if (!probeCheck || probeCheck.status !== 'fail') {
    throw new Error('probe 没有拦住契约外 outcome —— 第二道闸失效了');
  }

  return {
    naive: { status: naive.status, reason_code: naive.reason_code },
    caught: { status: caught.status, reason_code: caught.reason_code },
  };
}

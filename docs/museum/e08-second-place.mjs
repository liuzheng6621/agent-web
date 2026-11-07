/**
 * 展品 08 · 同一个洞，第二个地方
 *
 * 症状：`draft` 的录制回放路径上，适配器返回一个契约外的 outcome，
 *       这一步照样算通过，回放结果 `ok: true` —— 于是「录下来这段能跑」
 *       这个结论是在没验证那一步的前提下给出的。
 *
 * 为什么它值得单独一件展品：v0.60.0 修的是 `src/runner.mjs` 的 step-4 分支链，
 *       修得很干净，测试也补了。而 `src/draft.mjs` 里那段 if 是它的手抄副本，
 *       一字不差地带着同一个洞活了一个版本。**修的时候只修了看见的那一处。**
 *       这不是手滑，这是复制粘贴式复用必然会付的账。
 *
 * 谁抓住的：把分类语义抽成 `src/step-outcome.mjs`，两处都调它；
 *       外加 `test/step-outcome.test.mjs` 里那条**结构守卫** ——
 *       它扫两个文件的源码，只允许剩下 `res.outcome === 'applied'` 这一条手写分支。
 *       行为一致的测试抓不到这件事：两份实现都错的时候，它们一起对。
 *
 * naive 的复现方式：当前 `replayTrajectory` 已经修好，走不回旧路径，
 *       所以 naive 由**本地复刻旧的分支链**得出（把修之前那段 if 原样抄一遍）。
 */
import { replayTrajectory } from '../../src/draft.mjs';
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';

export const meta = {
  id: 'e08-second-place',
  title: '同一个洞的第二个地方：录制回放路径没有兜底分支',
  symptom: '回放返回 ok: true，而那一步的 outcome 不在契约里',
  mechanism: 'draft.mjs 手抄了 runner.mjs 的 if 链 · 修一处没修另一处 · 抽成 step-outcome.mjs 后两处共用',
  naive: 'pass',
  caught: 'unknown',
  caughtCode: 'contract_violation',
};

const STEPS = [
  {
    id: 's1',
    capability: 'order.create',
    as: 'customer',
    expected_outcome: 'applied',
    arguments: { items: [{ dishName: '拿铁', qty: 1 }] },
  },
];
const SCOPES = ['orders', 'menu'];

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
 * 旧版 draft 分支链的本地复刻。与修改前的 src/draft.mjs 逐条对应：
 *   unsupported / infra_error / 应拒却成 / 应成却拒 —— 四个 if，没有 else。
 * `'success'` 一条都不命中，于是 aborted 保持 null，函数返回 ok: true。
 */
async function legacyNaive() {
  const adapter = offContract('success');
  const runId = (await adapter.reset({})).runId;
  await adapter.observe(runId, SCOPES);
  let aborted = null;
  for (const step of STEPS) {
    const res = await adapter.execute(runId, {
      capability: step.capability,
      arguments: step.arguments,
      as: step.as,
    });
    if (res.outcome === 'unsupported') { aborted = { code: 'coverage_gap' }; break; }
    if (res.outcome === 'infra_error') { aborted = { code: 'infrastructure_error' }; break; }
    if (step.expected_outcome === 'applied' && res.outcome === 'rejected') { aborted = { code: 'unexpected_rejection' }; break; }
    if (step.expected_outcome === 'rejected' && res.outcome === 'applied') { aborted = { code: 'expected_rejection' }; break; }
    // ← 没有 else。契约外的值在这里既不算失败，也不算未知。
  }
  await adapter.close(runId);
  return { ok: aborted === null, aborted };
}

export async function run() {
  const naive = await legacyNaive();
  const caught = await replayTrajectory({
    adapter: offContract('success'),
    steps: STEPS,
    scopes: SCOPES,
  });

  if (caught.ok !== false) {
    throw new Error('回放路径没有拦住契约外 outcome —— 这个洞又回来了');
  }
  if (caught.aborted?.code !== 'contract_violation') {
    throw new Error(`回放路径拦住了，但理由码不对：${caught.aborted?.code}`);
  }

  // 回放路径不产出判决，只产出「这段录下来的步骤还能不能跑」。
  // 展品自检要的是 status / reason_code，所以这里做一次显式翻译，并把原始字段一并留着：
  //   ok: true  → status: pass     （每一步都被承认，回放结论成立）
  //   ok: false → status: unknown  （这一步没被承认，回放结论不成立）
  // 翻译成 unknown 而不是 fail：拦下来的原因是「这一步做成了没有，无法判断」，
  // 不是「它做错了」。这个区别正是整个项目要守住的那条线。
  return {
    naive: {
      status: 'pass',
      reason_code: 'ok',
      ok: naive.ok,
      code: naive.aborted?.code ?? null,
    },
    caught: {
      status: 'unknown',
      reason_code: caught.aborted?.code ?? 'contract_violation',
      ok: caught.ok,
      code: caught.aborted?.code ?? null,
    },
  };
}

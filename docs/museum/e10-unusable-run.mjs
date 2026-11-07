/**
 * 展品 10：环境没起来，certify 报了一个 0.0% 的抓获率。
 *
 * 这是 v0.63.1 补 `applies_to` 时顺手撞出来的，比 `applies_to` 本身严重得多。
 *
 * 起因是 animal 域的 certify 直接崩：`Cannot read properties of undefined
 * (reading 'adoption_applications')`。查下去发现两件事叠在一起：
 *
 *   1. 8181 后端没起，每条案例的 `base.verdict` 是 unknown/infrastructure_error，
 *      `base.ctx.initial` 与 `base.ctx.final` 都是 undefined。
 *   2. state 层变异体走「免重放」快路径，拿 undefined 去 `tamper(state)`，
 *      变异体第一行 `state.adoption_applications` 就 TypeError。
 *
 * 于是整个 certify 当场崩掉，报出来的是「Cannot read properties of undefined」——
 * 读者会以为变异体写错了，实际是环境没起来。
 *
 * 修掉崩溃之后露出了真正的问题：它不崩了，改成报 **0/5 = 0.0%**。
 * 那个 0.0% 在读者眼里是「这些断言一条都抓不住变异体」，
 * 实际含义是「一条案例都没跑起来」——两件事方向完全相反。
 *
 * 判据（`docs/SPEC.md` 第 11.1 节）：`unusable` 是一**组**码，不是一个码。
 * `infrastructure_error` / `contract_violation` / `effect_uncertain` 都表示
 * 「这一次执行本身不可信，与产品无关」；而 `missing_observation` 是真盲区，
 * 必须留在分母里。把这两类混在一起，工具就会把「没测」报成「测了但看不出来」。
 */

export const meta = {
  id: 'e10-unusable-run',
  title: '环境没起来，certify 报了个 0.0% 的抓获率',
  symptom: '输出「变异体抓获率 0/5 = 0.0%」，看着像断言一条都不管用；实际是一条案例都没跑起来',
  mechanism: 'base.ctx.initial 是 undefined 时快路径照样变换（崩），不崩时又把「没测」算成「没抓住」',
  naive: 'pass',
  caught: 'fail',
  caughtCode: 'unusable_run_reported_as_zero',
};

/** 复刻旧行为：把「一条都没跑起来」当成「一个都没抓住」，印出 0.0%。 */
function legacySummarize({ caught, applicable, allUnusable }) {
  // 旧代码里没有 allUnusable 这个概念，它只会算 caught / applicable。
  const rate = applicable === 0 ? null : caught / applicable;
  void allUnusable;
  return {
    line: `变异体抓获率 ${caught}/${applicable} = ${rate === null ? '—' : (rate * 100).toFixed(1) + '%'}`,
    exitCode: caught === applicable ? 0 : 1,
  };
}

export async function run() {
  const naive = legacySummarize({ caught: 0, applicable: 5, allUnusable: true });

  // 现在：certify 自己会说「这一跑不成立」，并且退 2 而不是 0。
  const { certifyExit, formatCertify } = await import('../../src/certify.mjs');
  const report = {
    version: 'agent-web/certify-1',
    adapter: 'animal',
    cases: [{ caseId: 'animal/animals-paginated', verdict: 'unknown', traceOk: false }],
    assertions: [],
    mutations: [
      {
        id: 'm-no-reject', title: '该拒的不拒', layer: 'execute', symptom: 's',
        caught: false, status: 'undetermined', killedBy: [], blindBy: [], survivedIn: [],
        verdictKills: 0, witnessCount: 0, suggestionBlocked: false,
        witness: null, suggestion: null, suggestionCount: 0, equivalence: null,
      },
    ],
    summary: {
      cases: 1, mutations: 1, applicable: 1, notApplicable: 0, caught: 0, survived: 1,
      killable: 0, undetermined: 1, suggestions: 0, caughtRate: null,
      unusableCases: ['animal/animals-paginated'], allUnusable: true,
    },
    minimal: { assertions: [], uncovered: ['m-no-reject'] },
  };
  const text = formatCertify(report);
  const exitCode = certifyExit(report);
  if (!/这一跑不成立/.test(text)) {
    throw new Error('certify 没有说明这一跑不成立 —— 环境故障又会被当成成绩报出去');
  }
  if (/变异体抓获率/.test(text)) {
    throw new Error('certify 在环境没起来时仍然印了抓获率');
  }
  if (exitCode !== 2) {
    throw new Error(`环境没起来时退出码应为 2（用法或环境错误），实际 ${exitCode}`);
  }

  return {
    naive: { status: 'pass', reason_code: 'ok', line: naive.line, exitCode: naive.exitCode },
    caught: {
      status: 'fail',
      reason_code: 'unusable_run_reported_as_zero',
      line: text.split(String.fromCharCode(10)).filter((l) => /这一跑不成立/.test(l))[0],
      exitCode,
    },
  };
}

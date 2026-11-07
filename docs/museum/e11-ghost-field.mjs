/**
 * 展品 11：传了四十多个版本，没人读的那个字段。
 *
 * `clock_policy` 从 v0.30.0 起就在 `src/runner.mjs` 里被读出来传给适配器：
 *
 *     const reset = await adapter.reset({
 *       seed: c.environment?.seed,
 *       clockPolicy: c.environment?.clock_policy,   // ← 从这一天起就在传
 *       snapshotRef: c.environment?.snapshot_ref,
 *     });
 *
 * 而事实是：**全仓 46 条案例没有一条声明过它**，`docs/SPEC.md` 第 2 章没写这个键，
 * `validateCase` 完全不校验 `environment`，11 个适配器里没有一个读过 `clockPolicy`。
 * 它从出生那天起就是空的。
 *
 * 同一个 `environment` 里还挂着两个同样的幽灵键。`cases/coffee/two-items.json` 写着：
 *
 *     "environment": {
 *       "adapter": "memory",
 *       "reset_strategy": "identity",        ← 全仓零处读它
 *       "scopes": ["orders","menu","status_log"]  ← 全仓零处读它
 *     }
 *
 * 这条案例的判决一直是 pass。它没错，只是那两行从来不代表任何东西。
 *
 * 为什么这种洞比崩溃更难发现：**它不报错**。写错的键、拼错的键、早就废弃的键，
 * 全都是「合法 JSON，安静地躺在那儿」。崩溃会有人修，安静没人管。
 *
 * 判据：`environment` 是一个**封闭**的键集合（`adapter` / `seed` / `clock_policy`），
 * 多一个键就是 `invalid_case`；适配器用 `manifest.clock_policies` 声明自己真支持哪几种，
 * 两边对不上在开跑之前就判 `unknown / invalid_environment`。
 */

export const meta = {
  id: 'e11-ghost-field',
  title: '传了四十多个版本、没人读的字段',
  symptom: '案例里写着 clock_policy / reset_strategy / scopes，判决 pass，但那三行从来没被任何代码读过',
  mechanism: 'environment 完全不校验 + 适配器不声明支持哪几种时钟 + 没有测试问「这个词谁认」',
  naive: 'pass',
  caught: 'unknown',
  caughtCode: 'invalid_environment',
};

/** 旧行为：environment 原样放过，一个键都不查。 */
function legacyValidateCase(doc) {
  // 旧版 validateCase 里根本没有 environment 这一节，所以它连看都没看一眼。
  void doc;
  return [];
}

/** 现在：只认三个键，多一个就报。 */
async function currentValidateCase(doc) {
  const { validateCase } = await import('../../src/case.mjs');
  return validateCase(doc);
}

const GHOST_CASE = {
  schema_version: 'agent-web/0.1',
  id: 'ghost/field',
  environment: {
    adapter: 'memory',
    reset_strategy: 'identity',
    scopes: ['orders', 'menu', 'status_log'],
  },
  task: {
    natural_goal: '读一次菜单',
    goal_assertions: [{ kind: 'entity_exists', selector: { collection: 'menu' } }],
  },
  reference_trajectory: [
    { id: 's1', capability: 'menu.list', as: 'customer', expected_outcome: 'applied' },
  ],
};

export async function run() {
  const legacyErrors = legacyValidateCase(GHOST_CASE);
  if (legacyErrors.length !== 0) {
    throw new Error('复刻的旧行为不成立：它本来应该一个错都不报');
  }

  const errors = await currentValidateCase(GHOST_CASE);
  if (errors.length === 0) {
    throw new Error('environment 里的幽灵键又溜过去了 —— 这个洞重新打开了');
  }
  const ghostKeys = ['reset_strategy', 'scopes'];
  for (const k of ghostKeys) {
    if (!errors.some((e) => e.includes(`environment.${k}`))) {
      throw new Error(`没有点名 environment.${k}：${errors.join('；')}`);
    }
  }

  // 第二道闸：时钟策略两边对不上，必须在开跑之前拦住，而不是等断言随机红。
  const { judge } = await import('../../src/runner.mjs');
  const { createMemoryAdapter } = await import('../../src/adapter/memory.mjs');
  const inner = createMemoryAdapter();
  const wallOnly = {
    ...inner,
    async manifest() { return { ...(await inner.manifest()), clock_policies: ['wall'] }; },
  };
  const verdict = await judge({
    case: {
      ...GHOST_CASE,
      environment: { adapter: 'memory', clock_policy: 'frozen' },
    },
    adapter: wallOnly,
  });
  if (verdict.status !== 'unknown' || verdict.reason_code !== 'invalid_environment') {
    throw new Error(`时钟对不上时应该判 unknown/invalid_environment，实际 ${verdict.status}/${verdict.reason_code}`);
  }
  if (!/案例要求时钟 frozen/.test(verdict.detail ?? '')) {
    throw new Error('判决没说明是时钟对不上：' + (verdict.detail ?? ''));
  }

  return {
    naive: { status: 'pass', reason_code: 'ok', detail: '环境校验为空，三个幽灵键一个都没报' },
    caught: {
      status: 'unknown',
      reason_code: 'invalid_environment',
      detail: errors[0],
      clockDetail: verdict.detail,
    },
  };
}

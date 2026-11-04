/**
 * 展品 05 · 卡住的适配器拖死整批
 *
 * 症状：被测系统的某个接口不返回（长事务、死锁、连接池耗尽），
 *       于是整批案例停在这一条上，跑到天亮也没结果，
 *       最后被人 Ctrl-C —— 而那 40 条本来已经跑完的判决也没了。
 *
 * 为什么三值逻辑抓不到：这不是断言的问题，是根本没有走到断言。
 *       没有硬上限的判决器会把「等待」当成一种状态，而等待没有判决。
 *
 * 谁抓住的：judge 的外层超时。单条超过上限判 unknown / infrastructure_error，
 *       批次继续往下跑。宁可 unknown，也不能让整批挂死。
 */
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';
import { judge } from '../../src/runner.mjs';

export const meta = {
  id: 'e05',
  title: '不返回的适配器让整批永远跑不完',
  symptom: '单条案例挂死，批次无输出',
  mechanism: 'judge 外层超时 · infrastructure_error',
  naive: '挂死（无判决）',
  caught: 'unknown',
  caughtCode: 'infrastructure_error',
};

const inlineCase = {
  schema_version: 'agent-web/0.1',
  id: 'museum/e05',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '下单。',
    goal_assertions: [
      { kind: 'count_delta', selector: { collection: 'orders' }, delta: 1 },
    ],
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
};

function hanging(inner) {
  return {
    manifest: () => inner.manifest(),
    reset: (o) => inner.reset(o),
    observe: (r, s) => inner.observe(r, s),
    close: (r) => inner.close(r),
    execute: () => new Promise(() => {}),
  };
}

export async function run() {
  const t0 = Date.now();
  const caught = await judge({
    case: inlineCase,
    adapter: hanging(createMemoryAdapter()),
    adapterName: 'hanging',
    timeoutMs: 80,
  });
  return {
    naive: null,
    caught: { status: caught.status, reason_code: caught.reason_code },
    elapsed_ms: Date.now() - t0,
  };
}

/**
 * 展品 04 · 把环境的错算在被测对象头上
 *
 * 症状：初态没准备好（种子没落、上一个用例没清干净、还是老数据），
 *       本来该说「这局不算」，却被记成一个 fail，然后进了失败率统计。
 *
 * 为什么三值逻辑抓不到：三值处理的是「断言求不出真假」。
 *       这里前置条件求得出，它明确为假——只是「假」不等于「被测系统做错了」。
 *
 * 谁抓住的：判决顺序第 6 条。前置条件为假判 unknown / invalid_initial_state，
 *       与第 16 条「目标断言为假判 fail」刻意不对称。
 *       不对称的理由：环境不干净不是被测对象的过错，把噪声算进去，
 *       失败率就再也不能用来判断「这次改动坏了什么」。
 */
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';
import { judge } from '../../src/runner.mjs';

export const meta = {
  id: 'e04',
  title: '前置条件为假被判成 fail',
  symptom: '初态不干净时输出 fail，污染失败率',
  mechanism: '判决顺序第 6 条 · invalid_initial_state',
  naive: 'fail',
  caught: 'unknown',
  caughtCode: 'invalid_initial_state',
};

const inlineCase = {
  schema_version: 'agent-web/0.1',
  id: 'museum/e04',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '在已有一笔订单的基础上再下一单。',
    preconditions: [
      { kind: 'entity_exists', selector: { collection: 'orders', index: 0 } },
    ],
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

export async function run() {
  const caught = await judge({
    case: inlineCase,
    adapter: createMemoryAdapter(),
    adapterName: 'memory',
  });
  return {
    naive: null,
    caught: { status: caught.status, reason_code: caught.reason_code },
  };
}

/**
 * 展品 03 · 机器写的考卷给自己打分
 *
 * 症状：从请求日志自动生成的案例，未经任何人看过，直接判 pass。
 *       生成器与判决器是同一个模型的产物，等于让出题的人自己批卷。
 *
 * 为什么三值逻辑抓不到：这类案例的断言往往是「照着我刚才成功的那次写」，
 *       所以它当然成立。没有任何一步是 unknown，全绿得很自然。
 *
 * 谁抓住的：判决顺序第 2 条。案例带 draft 字段且未 confirmed 时判
 *       unknown / unconfirmed_draft —— 它还不是一张考卷，没有资格得分。
 */
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';
import { judge } from '../../src/runner.mjs';

export const meta = {
  id: 'e03',
  title: '草稿闸门：未经人确认的机器生成案例直接产生判决',
  symptom: 'draft.status = unconfirmed 的案例输出 pass',
  mechanism: '判决顺序第 2 条 · unconfirmed_draft',
  naive: 'pass',
  caught: 'unknown',
  caughtCode: 'unconfirmed_draft',
};

const body = {
  schema_version: 'agent-web/0.1',
  id: 'museum/e03',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '下单并进入制作。',
    goal_assertions: [
      {
        kind: 'field_equals',
        selector: { collection: 'orders', index: 0 },
        path: 'status',
        value: 'MAKING',
      },
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
    {
      id: 's2',
      capability: 'kitchen.accept',
      as: 'staff',
      expected_outcome: 'applied',
      bindings: { orderId: '$s1.orderId' },
    },
  ],
};

export async function run() {
  const naive = await judge({
    case: { ...body, id: 'museum/e03-naive' },
    adapter: createMemoryAdapter(),
    adapterName: 'memory',
  });
  const caught = await judge({
    case: {
      ...body,
      id: 'museum/e03-caught',
      draft: { status: 'unconfirmed', generated_by: 'prepare', generated_at: '2026-11-04T00:00:00Z' },
    },
    adapter: createMemoryAdapter(),
    adapterName: 'memory',
  });
  return {
    naive: { status: naive.status, reason_code: naive.reason_code },
    caught: { status: caught.status, reason_code: caught.reason_code },
  };
}

/**
 * 展品 06 · 两个角色指向同一个身份
 *
 * 症状：适配器复位后声称自己绑了 customer 和 customer2 两个角色，
 *       实际两个角色拿到的是同一个账号。于是「另一个人能不能取走这杯」
 *       这条案例，永远测的是「本人能不能取走」。
 *
 * 为什么三值逻辑抓不到：同上——一切观测正常，只是缺少一个可以对照的第二人。
 *
 * 谁抓住的：runner 在复位之后对 roleBindings 做单射检查。
 *       两个角色指向同一身份判 unknown / invalid_environment：
 *       环境配错了，这一局不算。这是「可判性」的前置条件，不是断言。
 */
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';
import { judge } from '../../src/runner.mjs';

export const meta = {
  id: 'e06',
  title: '角色单射被破坏：两个角色共用一个身份',
  symptom: '涉及「另一个用户」的案例实际一直在用同一个用户',
  mechanism: 'runer 复位后 roleBindings 单射检查 · invalid_environment',
  naive: 'pass',
  caught: 'unknown',
  caughtCode: 'invalid_environment',
};

const inlineCase = {
  schema_version: 'agent-web/0.1',
  id: 'museum/e06',
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

function collapsed(inner) {
  return {
    manifest: () => inner.manifest(),
    reset: async (o) => {
      const r = await inner.reset(o);
      return { ...r, roleBindings: { customer: 'alice', customer2: 'alice', staff: 'barista' } };
    },
    observe: (r, s) => inner.observe(r, s),
    close: (r) => inner.close(r),
    execute: (r, a) => inner.execute(r, a),
  };
}

export async function run() {
  const naive = await judge({
    case: inlineCase,
    adapter: createMemoryAdapter(),
    adapterName: 'memory',
  });
  const caught = await judge({
    case: inlineCase,
    adapter: collapsed(createMemoryAdapter()),
    adapterName: 'collapsed',
  });
  return {
    naive: { status: naive.status, reason_code: naive.reason_code },
    caught: { status: caught.status, reason_code: caught.reason_code },
  };
}

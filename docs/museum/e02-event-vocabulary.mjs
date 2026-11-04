/**
 * 展品 02 · 事件词表缺失
 *
 * 症状：一条「绝不该出现退款事件」的断言，在压根不记录退款事件的后端上永远成立。
 *       「没查到你退款」被读成「你没有退款」，而真相是「我根本没看这个」。
 *
 * 为什么三值逻辑抓不到：这条断言返回的是货真价实的 TRUE，没有任何一步是「不知道」。
 *       要抓它，必须在断言之外另立一份「这个实现到底记录哪些事件类型」的声明。
 *
 * 谁抓住的：manifest.events_types。断言里出现不在词表内的类型时判 unknown，
 *       绝不返回 TRUE。词表把 events_complete 的承诺限定在真实存在的类型上。
 */
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';
import { judge } from '../../src/runner.mjs';

export const meta = {
  id: 'e02',
  title: '事件词表缺失：不记录的事被当成没发生的事',
  symptom: 'event_absent 断言在「后端不记这类事件」时恒为真',
  mechanism: 'manifest.events_types · 词表外类型判 unknown',
  naive: 'pass',
  caught: 'unknown',
  caughtCode: 'unsupported_event',
};

const inlineCase = {
  schema_version: 'agent-web/0.1',
  id: 'museum/e02',
  environment: { adapter: 'memory', seed: {} },
  task: {
    natural_goal: '下单并进入制作，全程不该出现退款事件。',
    goal_assertions: [
      {
        kind: 'field_equals',
        selector: { collection: 'orders', index: 0 },
        path: 'status',
        value: 'MAKING',
      },
    ],
    invariants: [{ kind: 'event_absent', type: 'order.refunded' }],
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

function withoutVocabulary(inner) {
  return {
    manifest: async () => {
      const m = await inner.manifest();
      delete m.events_types;
      return m;
    },
    reset: (o) => inner.reset(o),
    observe: (r, s) => inner.observe(r, s),
    close: (r) => inner.close(r),
    execute: (r, a) => inner.execute(r, a),
  };
}

export async function run() {
  const naive = await judge({
    case: inlineCase,
    adapter: withoutVocabulary(createMemoryAdapter()),
    adapterName: 'no-vocabulary',
  });
  const caught = await judge({
    case: inlineCase,
    adapter: createMemoryAdapter(),
    adapterName: 'memory',
  });
  return {
    naive: { status: naive.status, reason_code: naive.reason_code },
    caught: { status: caught.status, reason_code: caught.reason_code },
  };
}

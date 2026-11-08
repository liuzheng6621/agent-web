import { wrapState } from './_helpers.mjs';

// 「先发货后扣款」类坏法的最简形态：流水集合的两条相邻行写入顺序对调。
// 真实来源：流水异步落库时乱序提交、视图层读错排序键（比如按 id 而不是
// 按 created_at 排）。位置型断言（field_equals 钉绝对下标）抓它，但流水
// 前面多插一行系统行时位置断言会误报；相对序断言（precedence）在插行
// 场景下依然只看先后，是对这个坏法的**最小充分**约束。
export const meta = {
  id: 'm-log-order-swap',
  title: '流水行序颠倒：相邻两条流水的写入顺序对调',
  layer: 'state',
  symptom: '审计流水显示订单在被人接单之前就已经备好，先后颠倒',
  mechanism: '把 status_log[1] 与 status_log[2] 对调（making/ready 换位），模拟流水异步乱序落库或视图排序键读错',
  catch_hint: 'precedence(expect=[making, ready, ...]) 判 precedence_inverted；钉绝对下标的 field_equals 也抓，但插行场景会误报——相对序是这里的正确工具。',
  applies_to: { capabilities: ['kitchen.accept', 'kitchen.ready'], collections: ['status_log'] },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => {
    const rows = state.status_log;
    if (Array.isArray(rows) && rows.length >= 3) {
      const tmp = rows[1];
      rows[1] = rows[2];
      rows[2] = tmp;
    }
  });
}

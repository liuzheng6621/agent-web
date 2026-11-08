import { wrapState } from './_helpers.mjs';

/**
 * 观测缓存：observe 永远吐第一次的快照。
 *
 * 症状：案例每一步之间状态「纹丝不动」，但终态断言（initial_vs_final）全过
 * —— 因为首和尾都是同一张冻结快照，对比不出任何变化。
 * 怎么坏：把第一次 observe 拿到的 state 缓存进闭包，之后每次 observe 都把
 *         当前内容原地替换成缓存（tamper 是原地语义，返回值被忽略）。
 *         模拟「观测通道读到旧快照 / 中间层缓存永远不过期」。
 * 怎么抓：**按步看状态的断言** —— window / every_step 读 trace[].stateAfter，
 *         「下单后的那个窗口里订单数应该已经变成 1」，冻结后恒 0 → 判假。
 *         终态断言（field_equals/count_delta 的 final phase）抓不到它：
 *         initial 和 final 都是缓存，delta 恒 0 反而「对得上」。
 */
export const meta = {
  id: 'm-stale-oracle',
  title: '观测缓存：observe 永远返回第一次的快照',
  layer: 'state',
  symptom: '每步之间状态纹丝不动，终态断言却全过',
  mechanism: '闭包缓存第一次 observe 的快照，之后每次 observe 原地替换成缓存，模拟观测通道读到旧快照且缓存永不过期',
  catch_hint: '带写的案例里终态断言就会抓（冻结后 count_delta 恒 0 判假）；真正的漏网区是纯读案例与 unchanged 类不变量。window/every_step 读 trace[].stateAfter 是按步看得见冻结的正确工具。',
  applies_to: { capabilities: ['order.create'], collections: ['orders'] },
};

export function wrap(adapter) {
  let frozen = null;
  return wrapState(adapter, (state) => {
    if (frozen === null) {
      frozen = JSON.parse(JSON.stringify(state ?? {}));
      return;
    }
    // 原地替换内容（不是换对象 —— wrapState 的契约是篡改后返回同一引用）
    const out = frozen ?? {};
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, JSON.parse(JSON.stringify(out)));
  });
}

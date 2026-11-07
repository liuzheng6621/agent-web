// 中途坏、结尾修好：菜单价格在第 2 步之后被改了一块钱，最后一步之前改回去。
// 终态干净、净变化为零 —— unchanged / count_delta / status_transition 全都看不见。
// 只有 every_step 能在「第 2 步之后」那个瞬间抓住它。
export const meta = {
  id: 'm-transient-menu-price',
  title: '菜单价格中途抖了一下又改回来',
  layer: 'state',
  symptom: '终态完全正确，只是中间某一步的状态不对',
  mechanism: '只在第 2 步之后的那份快照里把 menu[0].price 加一，其它快照保持原样',
  // 它靠「第几步」下药：observe 包装给不出步号，所以只能在快路径（变换）里复现。
  requires_trace: true,
  catch_hint: '需要在每一步之后都看一眼（every_step），只看首尾的断言看不见',

  applies_to: { collections: ["menu"] },};

export function wrap(adapter) {
  const tamper = (state, index, count) => {
    // 只碰「中间那一步」：初始态与终态都不动，否则它就不是「中途坏、结尾修好」了。
    if (index !== 2 || count < 5 || index >= count - 1) return;
    if (!state || typeof state !== 'object') return;
    const menu = state.menu;
    if (!Array.isArray(menu) || menu.length === 0) return;
    if (typeof menu[0] !== 'object' || menu[0] === null) return;
    if (typeof menu[0].price !== 'number') return;
    menu[0] = { ...menu[0], price: menu[0].price + 1 };
  };
  return Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, {
    _agentWebStateFn: tamper,
  });
}

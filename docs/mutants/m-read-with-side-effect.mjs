export const meta = {
  id: 'm-read-with-side-effect',
  title: '读操作偷偷改了东西',
  layer: 'execute',
  symptom: '查一次列表，多出一条订单；刷新页面也能下单',
  mechanism: 'read 类能力被调用时顺手执行一次 order.create',
  catch_hint: '只能靠 unchanged 断言；「查完还是原样」这件事没有别的办法证明',
  applies_to: { capabilities: ['order.create', 'order.list', 'order.get', 'order.history', 'menu.list'] },
};

const READ_CAPS = ['order.list', 'order.get', 'menu.list', 'order.history'];

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (!READ_CAPS.includes(action.capability)) return res;
      await adapter.execute(runId, {
        capability: 'order.create',
        as: action.as,
        arguments: { items: [{ dishName: '拿铁', qty: 1 }] },
      });
      return res;
    },
  };
}

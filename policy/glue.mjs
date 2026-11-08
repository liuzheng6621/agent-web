// 把 agent-web 的 canonical view 翻译成 Rego 策略的输入（事件序列 + 订单快照）。
//
// 这一层是「第二声明」的接缝，也是整条链最容易被怀疑的地方：
// 翻译本身写错，策略再对也没意义。所以规则只有三条，且都可被 fixture 反证：
//
//   1. 只搬运，不计算。除了「首事件」以外，所有字段逐字来自 view。
//   2. 唯一一处合成：后端下单不落 t_order_status_log（见 docs/domains/coffee.md），
//      所以 `null -> PENDING` 这条起点事件必须从 orders 行合成，不能从流水读。
//      合成值写死成 (null, 'PENDING')，不给策略留想象空间。
//   3. 身份只做查表，不做推断。operatorId 由调用方显式给的 identities 映射决定；
//      查不到就写 null，让策略的 R7 报出来，而不是猜一个。

/** 合成起点事件用的常量：后端语义如此，不是策略的选择 */
const START_FROM = null;
const START_TO = 'PENDING';

/**
 * @param {object} args
 * @param {object} args.view        适配器 observe() 返回的 canonical view
 * @param {object} [args.identities] 用户名 -> 用户 id 的显式映射（不猜）
 * @param {string[]} [args.syntheticOrders] 已知起点事件缺失的订单 id（默认全部）
 * @returns {{orders: object[], events: object[]}}
 */
export function viewToPolicyInput({ view, identities = {}, syntheticOrders = null }) {
  if (!view || typeof view !== 'object') {
    throw new Error('viewToPolicyInput: view 必须是对象');
  }
  const orders = Array.isArray(view.orders) ? view.orders : [];
  const logs = Array.isArray(view.status_log) ? view.status_log : [];

  const userId = (name) => {
    if (name == null) return null;
    return Object.prototype.hasOwnProperty.call(identities, name) ? identities[name] : null;
  };

  const policyOrders = orders.map((o) => ({
    id: o.id,
    userId: userId(o.username),
    username: o.username,
    totalAmount: o.totalAmount,
    status: o.status,
    items: (o.items ?? []).map((it) => ({
      dishName: it.dishName,
      count: it.count,
      unitPrice: it.unitPrice,
      subTotal: it.subTotal,
    })),
  }));

  const events = logs.map((l) => ({
    orderId: l.orderId,
    from: l.from ?? null,
    to: l.to,
    operatorId: l.role === 'SYSTEM' ? null : userId(l.by),
    operatorName: l.by,
    operatorRole: l.role,
    at: l.at,
  }));

  // 起点事件：只给流水里确实没有起点的订单补，且补在时间序最前
  const hasStart = new Set(events.filter((e) => e.from == null).map((e) => e.orderId));
  const want = syntheticOrders == null
    ? policyOrders.map((o) => o.id)
    : syntheticOrders;
  const synthetic = [];
  for (const oid of want) {
    if (hasStart.has(oid)) continue;
    const o = policyOrders.find((x) => x.id === oid);
    if (!o) continue;
    const first = events
      .filter((e) => e.orderId === oid)
      .map((e) => e.at)
      .sort()[0];
    synthetic.push({
      orderId: oid,
      from: START_FROM,
      to: START_TO,
      operatorId: o.userId,
      operatorName: o.username,
      operatorRole: 'CUSTOMER',
      at: first ?? '',
      synthetic: true,
    });
  }

  const all = [...synthetic, ...events].sort((a, b) => {
    if (a.at === b.at) return 0;
    if (a.at === '') return -1;
    if (b.at === '') return 1;
    return a.at < b.at ? -1 : 1;
  });

  return { orders: policyOrders, events: all };
}

/** 把 view 的订单状态拼成「一条流水链」，给 DECISIONS.md 的对照表用 */
export function chainsOf(input) {
  const byOrder = new Map();
  for (const e of input.events) {
    if (!byOrder.has(e.orderId)) byOrder.set(e.orderId, []);
    byOrder.get(e.orderId).push(e);
  }
  return [...byOrder.entries()].map(([orderId, seq]) => ({
    orderId,
    path: seq.map((e) => `${e.from ?? 'null'}->${e.to}`).join(' '),
  }));
}

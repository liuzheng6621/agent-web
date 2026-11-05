/**
 * 内存适配器：一个确定性的小型业务系统，用来让仓库 clone 下来就能跑。
 *
 * 它复刻的是「一个带状态机、带角色、带事件流水的小后台」的最小形状，
 * 而不是任何真实应用的实现。目的只有一个：让判决引擎在没有外部依赖时也能被验证。
 *
 * 注意：它同时被 demo 与自测使用，但绝不作为「独立 oracle」。
 * 一个系统的两份拷贝互相印证，什么也证明不了。
 */

import { validateManifest } from './contract.mjs';

// 菜名与价格必须与参考实现（真实咖啡店 /waiter/menu）逐字一致。
// 这不是为了好看：案例里写的是菜名，mock 的菜单一旦自己编，同一份案例在真实
// 后端上就会因为「菜单里没有这道菜」变成 infrastructure_error —— 案例的可移植性
// 就是从这里漏掉的（two-items 案例曾用「美式」，真实后端叫「美式咖啡」）。
const MENU = [
  { id: 'latte', name: '拿铁', price: 28 },
  { id: 'americano', name: '美式咖啡', price: 22 },
  { id: 'signature', name: '太相恋特调', price: 38 },
];

const USERS = {
  alice: { id: 'u-alice', role: 'customer' },
  bob: { id: 'u-bob', role: 'customer' },
  barista: { id: 'u-barista', role: 'staff' },
};

// 状态机以真实业务规则为准，这里只是它的一份演示实现。
const TRANSITIONS = [
  { from: 'PENDING', to: 'MAKING', capability: 'kitchen.accept', roles: ['staff'] },
  { from: 'MAKING', to: 'READY', capability: 'kitchen.ready', roles: ['staff'] },
  { from: 'READY', to: 'PICKED', capability: 'order.pick', roles: ['customer'], ownerOnly: true },
  { from: 'PENDING', to: 'CANCELED', capability: 'order.cancel', roles: ['customer', 'staff'] },
];

const MANIFEST = {
  adapter: 'memory',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  description: '确定性内存业务系统：菜单 / 订单五态 / 角色 / 状态流水',
  scopes: ['menu', 'orders', 'status_log'],
  roles: ['customer', 'customer2', 'staff'],
  events_complete: true,
  // 词表把 events_complete 的承诺限定在"确实记录的类型"上：
  // 断言一个不在此列的 type，判决是 unknown/unsupported_event，不是 TRUE。
  events_types: ['order.created', 'order.making', 'order.ready', 'order.picked', 'order.canceled'],
  events_scope: 'status_log',
  canonical_view: 'agent-web/canonical-view',
  // 视图契约：断言写在这三个集合上，形状必须与 taixianglian 适配器一致，
  // 否则同一份案例在两个实现上的判决就没有可比性。
  view: {
    version: 'agent-web/view/1',
    collections: {
      menu: { kind: 'list', required: ['id', 'dishName', 'price'], semantics: '可售菜品' },
      orders: { kind: 'list', required: ['id', 'status', 'totalAmount', 'items'], semantics: '订单' },
      status_log: { kind: 'list', required: ['type', 'orderId', 'from', 'to'], semantics: '状态流水' },
    },
  },
  capabilities: [
    { id: 'menu.list', kind: 'read', evidence_level: 'validated', args: {}, roles: ['customer', 'staff'] },
    {
      id: 'order.create',
      kind: 'write',
      evidence_level: 'validated',
      args: { items: 'Array<{dishId:string, qty:number}>' },
      roles: ['customer'],
    },
    {
      id: 'order.list',
      kind: 'read',
      evidence_level: 'validated',
      args: { status: 'string?', page: 'number?', pageSize: 'number?' },
      roles: ['customer', 'staff'],
    },
    { id: 'order.get', kind: 'read', evidence_level: 'validated', args: { orderId: 'number' }, roles: ['customer', 'staff'] },
    { id: 'order.cancel', kind: 'write', evidence_level: 'validated', args: { orderId: 'number' }, roles: ['customer', 'staff'] },
    { id: 'order.pick', kind: 'write', evidence_level: 'validated', args: { orderId: 'number' }, roles: ['customer'] },
    { id: 'kitchen.accept', kind: 'write', evidence_level: 'validated', args: { orderId: 'number' }, roles: ['staff'] },
    { id: 'kitchen.ready', kind: 'write', evidence_level: 'validated', args: { orderId: 'number' }, roles: ['staff'] },
    { id: 'order.history', kind: 'read', evidence_level: 'validated', args: { orderId: 'number' }, roles: ['customer', 'staff'] },
  ],
};

class Reject extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function initialState(seed) {
  return {
    menu: MENU.map((m) => ({ ...m })),
    orders: [],
    status_log: [],
    __seq: 1000,
    __clock: seed?.clock_start ?? 1767225600000,
  };
}

export function createMemoryAdapter() {
  const runs = new Map();

  const manifest = async () => JSON.parse(JSON.stringify(MANIFEST));

  async function reset({ seed } = {}) {
    const runId = `mem-${runs.size + 1}`;
    const state = initialState(seed);
    const ctx = { state, actions: 0 };
    runs.set(runId, ctx);
    // roleBindings 必须单射：不同角色必须绑到不同身份。
    return {
      runId,
      state: view(state),
      roleBindings: { customer: 'alice', customer2: 'bob', staff: 'barista' },
    };
  }

  /**
   * 规范视图：所有适配器都必须把状态投影成这一份形状。
   * 同一份案例于是既能跑内存适配器，也能跑真实后端 —— 案例可移植，才谈得上对照。
   */
  function view(state) {
    return {
      menu: state.menu.map((m) => ({ id: m.id, dishName: m.name, price: m.price, category: null })),
      orders: state.orders.map((o) => ({
        id: o.id,
        username: o.ownerName,
        status: o.status,
        totalAmount: o.total,
        pickupNo: 100 + o.id,
        createTime: o.createdAt,
        items: o.items.map((i) => ({
          dishName: i.name,
          count: i.qty,
          unitPrice: i.price,
          subTotal: i.price * i.qty,
        })),
      })),
      status_log: state.status_log.map((l) => ({
        id: l.id,
        type: l.type,
        orderId: l.orderId,
        from: l.from,
        to: l.to,
        by: l.by,
        at: l.at,
      })),
    };
  }

  async function observe(runId) {
    const ctx = runs.get(runId);
    if (!ctx) return { state: null, missingScopes: MANIFEST.scopes };
    return { state: view(ctx.state), missingScopes: [] };
  }

  function requireRun(runId) {
    const ctx = runs.get(runId);
    if (!ctx) throw new Reject('no_run', `运行 ${runId} 不存在`);
    return ctx;
  }

  function tick(ctx) {
    ctx.actions += 1;
    ctx.state.__clock += 1000;
    return ctx.state.__clock;
  }

  function nextOrderId(ctx) {
    ctx.state.__seq += 1;
    return ctx.state.__seq;
  }

  function log(ctx, entry) {
    ctx.state.status_log.push({ id: ctx.state.status_log.length + 1, at: ctx.state.__clock, ...entry });
  }

  // 案例面向角色寻址，适配器负责把角色绑到具体身份上。
  const ROLE_ALIAS = { customer: 'alice', customer2: 'bob', staff: 'barista' };

  function actor(action) {
    const key = action.as ?? 'customer';
    const who = ROLE_ALIAS[key] ?? key;
    const user = USERS[who];
    if (!user) throw new Reject('unknown_actor', `未知身份 ${who}`);
    return { name: who, ...user };
  }

  function requireCap(capabilityId, who) {
    const cap = MANIFEST.capabilities.find((c) => c.id === capabilityId);
    if (!cap) throw new Reject('unsupported_capability', `能力 ${capabilityId} 不在 manifest 中`);
    if (!cap.roles.includes(who.role)) {
      throw new Reject('forbidden', `${who.name}(${who.role}) 无权执行 ${capabilityId}`);
    }
    return cap;
  }

  function findOrder(ctx, orderId) {
    const o = ctx.state.orders.find((x) => x.id === Number(orderId));
    if (!o) throw new Reject('not_found', `订单 ${orderId} 不存在`);
    return o;
  }

  function transition(ctx, order, capabilityId, who) {
    const rule = TRANSITIONS.find((t) => t.capability === capabilityId && t.from === order.status);
    if (!rule) {
      const allowed = TRANSITIONS.filter((t) => t.capability === capabilityId).map((t) => t.from);
      throw new Reject(
        'invalid_transition',
        `订单 ${order.id} 当前 ${order.status}，不允许通过 ${capabilityId} 迁移（合法来源：${allowed.join('/') || '无'}）`,
      );
    }
    if (rule.ownerOnly && order.ownerId !== who.id) {
      throw new Reject('not_owner', `订单 ${order.id} 不属于 ${who.name}`);
    }
    const from = order.status;
    order.status = rule.to;
    log(ctx, { type: `order.${rule.to.toLowerCase()}`, orderId: order.id, from, to: rule.to, by: who.name });
    return order;
  }

  async function executeInner(runId, action) {
    // 未知角色必须显式拒绝：回落到默认身份会让"换个身份再来一次"静默失效。
    if (action.as && !(MANIFEST.roles ?? []).includes(action.as)) {
      return { outcome: 'rejected', error: { code: 'unknown_role', message: `角色 ${action.as} 不在 manifest.roles 里` } };
    }
    let ctx;
    try {
      ctx = requireRun(runId);
    } catch (e) {
      return { outcome: 'infra_error', error: { code: e.code, message: e.message } };
    }

    try {
      const who = actor(action);
      requireCap(action.capability, who);
      tick(ctx);

      switch (action.capability) {
        case 'menu.list':
          return { outcome: 'applied', payload: { menu: view(ctx.state).menu } };

        case 'order.create': {
          const items = action.arguments?.items;
          if (!Array.isArray(items) || items.length === 0) {
            throw new Reject('invalid_argument', 'items 必须是非空数组');
          }
          const resolved = items.map((it) => {
            // 案例可以按菜品 id 或菜名下单：真实后端按菜名，内存适配器两种都收。
            const dish = MENU.find((m) => String(m.id) === String(it.dishId) || m.name === it.dishName);
            if (!dish) throw new Reject('invalid_argument', `未知菜品 ${it.dishId ?? it.dishName}`);
            const qty = Number(it.qty ?? it.count);
            if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
              throw new Reject('invalid_argument', `qty 必须是 1..99 的整数，收到 ${it.qty}`);
            }
            return { dishId: dish.id, name: dish.name, qty, price: dish.price };
          });
          const order = {
            id: nextOrderId(ctx),
            ownerId: who.id,
            ownerName: who.name,
            status: 'PENDING',
            items: resolved,
            total: resolved.reduce((s, x) => s + x.price * x.qty, 0),
            createdAt: ctx.state.__clock,
          };
          ctx.state.orders.push(order);
          log(ctx, { type: 'order.created', orderId: order.id, from: null, to: 'PENDING', by: who.name });
          return { outcome: 'applied', payload: { orderId: order.id, status: order.status } };
        }

        case 'order.list': {
          // 注意：规范视图里没有 ownerId（只有 username），所以「只看自己的单」
          // 必须在原始状态上过滤完再投影 —— 在视图上过滤会把顾客的列表永远filter成空。
          let mine = ctx.state.orders.filter((o) => o.ownerId === who.id || who.role === 'staff');
          if (action.arguments?.status) {
            mine = mine.filter((o) => o.status === action.arguments.status);
          }
          let list = view({ ...ctx.state, orders: mine }).orders;
          // 分页是真的切，不是装样子：给了 pageSize 就按页返回，
          // 并把 page / total / hasMore 一起报出来（分页检查会用它们）。
          const pageSize = Number(action.arguments?.pageSize);
          if (Number.isFinite(pageSize) && pageSize > 0) {
            const page = Number.isFinite(Number(action.arguments?.page)) && Number(action.arguments?.page) > 0
              ? Number(action.arguments.page)
              : 1;
            const start = (page - 1) * pageSize;
            const rows = list.slice(start, start + pageSize);
            return {
              outcome: 'applied',
              payload: {
                orders: rows,
                page,
                pageSize,
                total: list.length,
                hasMore: start + pageSize < list.length,
              },
            };
          }
          return { outcome: 'applied', payload: { orders: list } };
        }

        case 'order.get': {
          const o = findOrder(ctx, action.arguments?.orderId);
          if (o.ownerId !== who.id && who.role !== 'staff') {
            throw new Reject('not_owner', `订单 ${o.id} 不属于 ${who.name}`);
          }
          return { outcome: 'applied', payload: { order: { ...o } } };
        }

        case 'order.cancel':
        case 'order.pick':
        case 'kitchen.accept':
        case 'kitchen.ready': {
          const o = findOrder(ctx, action.arguments?.orderId);
          if (who.role === 'customer' && o.ownerId !== who.id) {
            throw new Reject('not_owner', `订单 ${o.id} 不属于 ${who.name}`);
          }
          const next = transition(ctx, o, action.capability, who);
          return { outcome: 'applied', payload: { orderId: next.id, status: next.status } };
        }

        case 'order.history': {
          const o = findOrder(ctx, action.arguments?.orderId);
          const items = ctx.state.status_log.filter((l) => l.orderId === o.id);
          return { outcome: 'applied', payload: { logs: items } };
        }

        default:
          return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
      }
    } catch (e) {
      if (e instanceof Reject) {
        return { outcome: 'rejected', error: { code: e.code, message: e.message } };
      }
      return { outcome: 'infra_error', error: { code: 'adapter_error', message: String(e && e.message) } };
    }
  }

  async function close(runId) {
    runs.delete(runId);
  }

  /**
   * 包一层只为记下「这一步到底是谁执行的」。
   *
   * 身份塌缩是这类系统最难抓的失败：每一步都合法、观测都真实、判决也完全正确，
   * 只是执行的人被悄悄换成了另一个。没有这条记录，事后连查都没法查。
   */
  async function execute(runId, action) {
    const r = await executeInner(runId, action);
    let who = null;
    try {
      who = actor(action);
    } catch {
      who = null; // 未知角色没有身份可记，这一步本来就该被拒
    }
    if (who && r && typeof r === 'object') r.identity = who.name;
    return r;
  }

  return { manifest, reset, observe, execute, close };
}

export function validateMemoryAdapter() {
  return validateManifest(MANIFEST);
}

/**
 * 咖啡店后端适配器（真实 HTTP）。
 *
 * reset 走第三条路径：身份隔离。
 * 每个 run 注册一个全新顾客账号，订单天然分属这个账号，
 * 既不需要清库，也不需要事务回滚 —— 这就是「应用本来就有账号体系」的红利。
 *
 * 状态投影成规范视图（canonical view），字段名与内存适配器完全一致：
 * 同一份案例既能跑 mock，也能跑真实后端，才谈得上对照。
 */

import { validateManifest } from './contract.mjs';

export const CANONICAL_VIEW = 'agent-web/canonical-view';

const STAFF = { username: 'barista', password: 'latte123' };
const RESULT_OK = 200;

// 业务码 → 适配器结果。401 系列算基础设施问题：token 由适配器自己管，不该出现在业务拒绝里。
const INFRA_CODES = new Set([40101, 40102]);

class Infra extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MANIFEST = {
  adapter: 'taixianglian',
  adapter_version: '1.0.0',
  reset_strategy: 'identity',
  canonical_view: CANONICAL_VIEW,
  description: '咖啡店后台（Spring Boot）：菜单 / 订单五态 / 顾客与店员 / 状态流水',
  scopes: ['menu', 'orders', 'status_log'],
  events_scope: 'status_log',
  // 与 memory 适配器逐字相同：视图契约一致，案例才真的可移植。
  // compare 会比对这两份声明，不一致会直接打出来。
  view: {
    version: 'agent-web/view/1',
    collections: {
      menu: { kind: 'list', required: ['id', 'dishName', 'price'], semantics: '可售菜品' },
      orders: { kind: 'list', required: ['id', 'status', 'totalAmount', 'items'], semantics: '订单' },
      status_log: { kind: 'list', required: ['type', 'orderId', 'from', 'to'], semantics: '状态流水' },
    },
  },
  roles: ['customer', 'customer2', 'staff'],
  events_complete: true,
  // 只声明真实存在的事件类型：后端 t_order_status_log 只记"迁移"，
  // 下单本身不落流水，所以没有 order.created。缺了它，对创建事件做
  // event_absent 会得到一个假的 TRUE —— 词表让这种断言退回 unknown。
  events_types: ['order.making', 'order.ready', 'order.picked', 'order.canceled'],
  reset_note:
    'identity：每个 run 注册一个新顾客账号；staff 用预置店员账号。不清库、不回滚，靠身份隔离保证互不影响。',
  capabilities: [
    { id: 'menu.list', kind: 'read', evidence_level: 'validated', roles: ['customer', 'staff'], http: 'GET /waiter/menu' },
    {
      id: 'order.create',
      kind: 'write',
      evidence_level: 'validated',
      roles: ['customer'],
      http: 'POST /waiter/order',
      args: { items: 'Array<{dishId, qty}>（适配器按菜名映射）' },
    },
    { id: 'order.list', kind: 'read', evidence_level: 'validated', roles: ['customer', 'staff'], http: 'GET /waiter/order/list' },
    { id: 'order.get', kind: 'read', evidence_level: 'validated', roles: ['customer', 'staff'], http: 'GET /waiter/order/{id}' },
    { id: 'order.cancel', kind: 'write', evidence_level: 'validated', roles: ['customer'], http: 'POST /waiter/order/{id}/cancel' },
    { id: 'order.pick', kind: 'write', evidence_level: 'validated', roles: ['customer'], http: 'POST /waiter/order/{id}/pick' },
    { id: 'kitchen.accept', kind: 'write', evidence_level: 'validated', roles: ['staff'], http: 'POST /kitchen/order/{id}/accept' },
    { id: 'kitchen.ready', kind: 'write', evidence_level: 'validated', roles: ['staff'], http: 'POST /kitchen/order/{id}/ready' },
    { id: 'kitchen.cancel', kind: 'write', evidence_level: 'validated', roles: ['staff'], http: 'POST /kitchen/order/{id}/cancel' },
    { id: 'kitchen.pick', kind: 'write', evidence_level: 'validated', roles: ['staff'], http: 'POST /kitchen/order/{id}/pick' },
    { id: 'order.history', kind: 'read', evidence_level: 'validated', roles: ['customer', 'staff'], http: 'GET /waiter/order/{id}/history' },
    {
      id: 'menu.image.upload',
      kind: 'write',
      evidence_level: 'inferred',
      roles: ['staff'],
      http: 'POST /menu/{id}/image (multipart)',
      note: '需要 multipart 与 StorageService；v0.1 未接线，声明为 inferred',
    },
  ],
};

export function createTaixianglianAdapter(options = {}) {
  const baseUrl = (options.baseUrl ?? process.env.TAIXIANGLIAN_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10000;
  const runs = new Map();
  let seq = 0;

  const manifest = async () => JSON.parse(JSON.stringify(MANIFEST));

  async function call(method, path, { body, token } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Infra('network_error', `${method} ${path} 失败：${e && e.message}`);
    }
    const text = await res.text();
    if (text === '') return { code: res.status, msg: '', data: null };
    try {
      return JSON.parse(text);
    } catch {
      throw new Infra('bad_response', `${method} ${path} 返回非 JSON（HTTP ${res.status}）`);
    }
  }

  function classify(payload) {
    if (!payload || typeof payload.code !== 'number') {
      return { outcome: 'infra_error', error: { code: 'bad_response', message: '响应缺少 code' } };
    }
    if (payload.code === RESULT_OK) return { outcome: 'applied', payload: payload.data };
    if (INFRA_CODES.has(payload.code) || payload.code >= 50000) {
      return { outcome: 'infra_error', error: { code: String(payload.code), message: payload.msg } };
    }
    return { outcome: 'rejected', error: { code: String(payload.code), message: payload.msg } };
  }

  async function login(username, password) {
    const r = await call('POST', '/login', { body: { username, password } });
    if (r.code !== RESULT_OK || !r.data?.accessToken) {
      throw new Infra('login_failed', `${username} 登录失败：${r.code} ${r.msg}`);
    }
    return { username, role: String(r.data.role ?? 'CUSTOMER').toLowerCase(), token: r.data.accessToken };
  }

  async function registerOne(tag) {
    const username = `aw_${Date.now().toString(36)}_${seq}${tag}`;
    const password = 'aw-pass-123';
    const reg = await call('POST', '/register', { body: { username, password, nickname: username } });
    if (reg.code !== RESULT_OK) {
      throw new Infra('register_failed', `注册 ${username} 失败：${reg.code} ${reg.msg}`);
    }
    return login(username, password);
  }

  async function reset() {
    seq += 1;
    // 一个 run 三个身份：主顾客、次顾客（用于越权类案例）、店员。
    // 每多一个身份就多一次注册，这是 identity 复位必须认的成本。
    const customer = await registerOne('a');
    const customer2 = await registerOne('b');
    const staff = await login(STAFF.username, STAFF.password);

    const runId = `txl-${seq}`;
    runs.set(runId, { customer, customer2, staff });
    return {
      runId,
      state: await observeState(runId),
      // 每个角色一个独立真实账号，这就是 identity 复位的全部含义。
      roleBindings: {
        customer: customer.username,
        customer2: customer2.username,
        staff: staff.username,
      },
    };
  }

  const ACTION_ROUTES = {
    'order.cancel': { method: 'POST', path: (id) => `/waiter/order/${id}/cancel`, who: 'customer' },
    'order.pick': { method: 'POST', path: (id) => `/waiter/order/${id}/pick`, who: 'customer' },
    'kitchen.accept': { method: 'POST', path: (id) => `/kitchen/order/${id}/accept`, who: 'staff' },
    'kitchen.ready': { method: 'POST', path: (id) => `/kitchen/order/${id}/ready`, who: 'staff' },
    'kitchen.cancel': { method: 'POST', path: (id) => `/kitchen/order/${id}/cancel`, who: 'staff' },
    'kitchen.pick': { method: 'POST', path: (id) => `/kitchen/order/${id}/pick`, who: 'staff' },
  };

  function normOrder(o) {
    return {
      id: o.id,
      username: o.username ?? null,
      status: o.status ?? null,
      totalAmount: o.totalAmount ?? null,
      pickupNo: o.pickupNo ?? null,
      createTime: o.createTime ?? null,
      items: (o.items ?? []).map((i) => ({
        dishName: i.dishName ?? i.name ?? null,
        count: i.count ?? i.qty ?? null,
        unitPrice: i.unitPrice ?? i.price ?? null,
        subTotal: i.subTotal ?? null,
      })),
    };
  }

  async function observeState(runId) {
    const ctx = runs.get(runId);
    if (!ctx) throw new Infra('no_run', `运行 ${runId} 不存在`);

    const menuR = await call('GET', '/waiter/menu');
    const menu = (menuR.data ?? []).map((m) => ({
      id: m.id,
      dishName: m.dishName ?? null,
      price: m.price ?? null,
      category: m.category ?? null,
    }));

    const listR = await call('GET', '/waiter/order/list?page=0&size=200', { token: ctx.customer.token });
    const orders = ((listR.data?.list ?? [])).map(normOrder);

    // 事件流按订单拉流水。规模小的时候最省事，也好解释清楚「观测成本在哪」。
    const status_log = [];
    for (const o of orders) {
      const h = await call('GET', `/waiter/order/${o.id}/history`, { token: ctx.customer.token });
      if (h.code !== RESULT_OK || !Array.isArray(h.data)) continue;
      h.data.forEach((l, i) => {
        status_log.push({
          id: `${o.id}:${i}`,
          type: `order.${String(l.toStatus ?? '').toLowerCase()}`,
          orderId: o.id,
          from: l.fromStatus ?? null,
          to: l.toStatus ?? null,
          by: l.operatorName ?? null,
          role: l.operatorRole ?? null,
          note: l.note ?? null,
          at: l.createdAt ?? null,
        });
      });
    }

    return { menu, orders, status_log };
  }

  async function observe(runId) {
    try {
      return { state: await observeState(runId), missingScopes: [] };
    } catch (e) {
      return { state: null, missingScopes: MANIFEST.scopes, reason: e && e.message };
    }
  }

  async function execute(runId, action) {
    // 未知角色必须显式拒绝：回落到默认身份会让"换个身份再来一次"静默失效。
    if (action.as && !(MANIFEST.roles ?? []).includes(action.as)) {
      return { outcome: 'rejected', error: { code: 'unknown_role', message: `角色 ${action.as} 不在 manifest.roles 里` } };
    }
    const ctx = runs.get(runId);
    if (!ctx) return { outcome: 'infra_error', error: { code: 'no_run', message: `运行 ${runId} 不存在` } };

    const args = action.arguments ?? {};
    const AS = { staff: ctx.staff, customer2: ctx.customer2, customer: ctx.customer };
    const who = AS[action.as] ?? ctx.customer;

    try {
      if (action.capability === 'menu.list') {
        const r = await call('GET', '/waiter/menu');
        const c = classify(r);
        return c.outcome === 'applied' ? { outcome: 'applied', payload: { menu: r.data ?? [] } } : c;
      }

      if (action.capability === 'order.create') {
        const menuR = await call('GET', '/waiter/menu');
        const menu = menuR.data ?? [];
        const items = Array.isArray(args.items) ? args.items : [];
        if (items.length === 0) {
          return { outcome: 'rejected', error: { code: 'invalid_argument', message: 'items 必须是非空数组' } };
        }
        const dishList = items.map((it) => {
          const dish = menu.find((m) => String(m.id) === String(it.dishId) || m.dishName === it.dishName);
          if (!dish) throw new Infra('unknown_dish', `菜单里没有 ${it.dishId ?? it.dishName}`);
          return { dishName: dish.dishName, count: Number(it.qty ?? it.count) };
        });
        const r = await call('POST', '/waiter/order', { body: { dishList }, token: who.token });
        const c = classify(r);
        if (c.outcome !== 'applied') return c;
        return { outcome: 'applied', payload: { orderId: c.payload?.id ?? null, status: c.payload?.status ?? null } };
      }

      if (action.capability === 'order.list') {
        const q = args.status ? `?page=0&size=50&status=${encodeURIComponent(args.status)}` : '?page=0&size=50';
        const r = await call('GET', `/waiter/order/list${q}`, { token: who.token });
        const c = classify(r);
        return c.outcome === 'applied'
          ? { outcome: 'applied', payload: { total: r.data?.total ?? 0, orders: (r.data?.list ?? []).map(normOrder) } }
          : c;
      }

      if (action.capability === 'order.get') {
        const r = await call('GET', `/waiter/order/${args.orderId}`, { token: who.token });
        const c = classify(r);
        return c.outcome === 'applied' ? { outcome: 'applied', payload: { order: normOrder(r.data ?? {}) } } : c;
      }

      if (action.capability === 'order.history') {
        const r = await call('GET', `/waiter/order/${args.orderId}/history`, { token: who.token });
        const c = classify(r);
        return c.outcome === 'applied' ? { outcome: 'applied', payload: { logs: r.data ?? [] } } : c;
      }

      const route = ACTION_ROUTES[action.capability];
      if (route) {
        // 必须用 who.token：route.who 只说明走哪条业务线（店员线/顾客线），
        // 不说明具体是谁。曾经这里写死 ctx.customer.token，把 customer2 塌缩成
        // customer，越权案例因此假通过——身份必须由案例的 as 决定。
        const token = who.token;
        const r = await call(route.method, route.path(args.orderId), { token });
        const c = classify(r);
        return c.outcome === 'applied'
          ? { outcome: 'applied', payload: { orderId: r.data?.id ?? args.orderId, status: r.data?.status ?? null } }
          : c;
      }

      return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
    } catch (e) {
      if (e instanceof Infra) return { outcome: 'infra_error', error: { code: e.code, message: e.message } };
      return { outcome: 'infra_error', error: { code: 'adapter_error', message: String(e && e.message) } };
    }
  }

  async function close(runId) {
    runs.delete(runId);
  }

  /**
   * record 用的反向映射：把一个真实请求还原成案例能用的参数。
   * 返回 null 表示"这条请求我认不出参数"，record 会把它记进 skipped 而不是瞎猜。
   */
  function toStep(entry, matched) {
    const cap = matched.capability;
    if (cap === 'order.create') {
      const list = entry?.body?.dishList;
      if (!Array.isArray(list) || list.length === 0) return null;
      return { items: list.map((it) => ({ dishName: it.dishName, qty: Number(it.count ?? it.qty ?? 1) })) };
    }
    const id = matched?.params?.id;
    if (id !== undefined) return { orderId: Number(id) };
    return {};
  }

  return { manifest, reset, observe, execute, close, baseUrl, toStep };
}

export function validateTaixianglianAdapter() {
  return validateManifest(MANIFEST);
}

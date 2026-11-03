/**
 * 适配器骨架：仓库出库单。
 *
 * 这份文件回答一个问题：**怎么把 agent-web 接到我自己的系统上**。
 *
 * 故意选了一个和仓库内置案例无关的业务（仓库出库，不是咖啡店），
 * 用来证明：断言、判决、复位这套东西不绑定任何具体应用。
 *
 * 三步走：
 *   1. MANIFEST       —— 你的系统有哪些能力，每条可信到什么程度
 *   2. reset/observe  —— 怎么复位，怎么把状态投影成规范视图
 *   3. execute        —— 一个动作怎么落到你的 API 上
 *
 * 现在它跑在一个内置的内存后端上（createBackend），clone 下来就能跑：
 *
 *   node bin/agent-web.mjs verify examples/adapter-template/cases \
 *     --adapter=./examples/adapter-template/warehouse-adapter.mjs
 *
 * 换成真后端时，只改 createBackend() 里的方法体（换成 fetch），
 * MANIFEST、reset、observe、execute 的骨架都不用动。
 */

export const CANONICAL_VIEW = 'agent-web/canonical-view';

const ROLES = ['clerk', 'clerk2', 'manager'];

const MANIFEST = {
  adapter: 'warehouse-template',
  adapter_version: '0.1.0',
  reset_strategy: 'snapshot',
  canonical_view: CANONICAL_VIEW,
  description: '仓库出库单：库存 / 四态出库单 / 制单员与审批员',
  scopes: ['stock', 'pickings', 'events'],
  // 事件流在哪个集合里。event_absent 断言靠它判断「能不能断言没发生」。
  events_scope: 'events',
  events_complete: true,
  roles: ROLES,
  // 视图契约：断言写在这些名字和字段上。声明之后，
  // 适配器漏投影一个集合会得到 invalid_environment，而不是让每条断言各自报「没观测到」。
  view: {
    version: 'agent-web/view/1',
    collections: {
      stock: { kind: 'list', required: ['sku', 'onHand', 'reserved'], semantics: '库存' },
      pickings: { kind: 'list', required: ['id', 'sku', 'qty', 'status', 'owner'], semantics: '出库单' },
      events: { kind: 'list', required: ['id', 'type', 'pickingId'], semantics: '状态流水' },
    },
  },
  reset_note: 'snapshot：每次 reset 重建一份内存快照，案例之间不共享状态。',
  capabilities: [
    { id: 'stock.list', kind: 'read', evidence_level: 'validated', roles: ['clerk', 'manager'] },
    {
      id: 'picking.create',
      kind: 'write',
      evidence_level: 'validated',
      roles: ['clerk'],
      args: { sku: 'string', qty: 'number' },
    },
    { id: 'picking.submit', kind: 'write', evidence_level: 'validated', roles: ['clerk'] },
    { id: 'picking.approve', kind: 'write', evidence_level: 'validated', roles: ['manager'] },
    { id: 'picking.ship', kind: 'write', evidence_level: 'validated', roles: ['manager'] },
    { id: 'picking.cancel', kind: 'write', evidence_level: 'validated', roles: ['clerk'] },
    { id: 'picking.list', kind: 'read', evidence_level: 'validated', roles: ['clerk', 'manager'] },
    {
      id: 'stock.adjust',
      kind: 'write',
      // 声明为 inferred 的示范：这个能力骨架里没实现，
      // 案例用它时判决会是 unknown / coverage_gap，而不是静默通过。
      evidence_level: 'inferred',
      roles: ['manager'],
      note: '盘点调整，骨架未实现',
    },
  ],
};

// ---------------------------------------------------------------- 后端
// 这里是「你的系统」。换成真后端时只改这一段。

function createBackend() {
  let db;

  function fresh() {
    return {
      stock: [
        { sku: 'SKU-001', name: '螺丝', onHand: 100, reserved: 0 },
        { sku: 'SKU-002', name: '垫片', onHand: 50, reserved: 0 },
        { sku: 'SKU-003', name: '轴承', onHand: 10, reserved: 0 },
      ],
      pickings: [],
      events: [],
      nextId: 1,
      clock: 0,
    };
  }

  function now() {
    db.clock += 1;
    return `T${String(db.clock).padStart(4, '0')}`;
  }

  function emit(picking, from, to, who) {
    db.events.push({
      id: `e${db.events.length + 1}`,
      type: `picking.${to.toLowerCase()}`,
      pickingId: picking.id,
      from,
      to,
      by: who,
      at: now(),
    });
  }

  // 状态机：和真实系统一样，非法迁移要在这里被挡住。
  const TRANSITIONS = {
    DRAFT: ['SUBMITTED', 'CANCELED'],
    SUBMITTED: ['APPROVED', 'CANCELED'],
    APPROVED: ['SHIPPED'],
    SHIPPED: [],
    CANCELED: [],
  };

  function findPicking(id) {
    const p = db.pickings.find((x) => x.id === id);
    if (!p) throw new BizError('not_found', `出库单 ${id} 不存在`);
    return p;
  }

  function move(picking, to, who) {
    const from = picking.status;
    if (!TRANSITIONS[from].includes(to)) {
      throw new BizError('invalid_transition', `${from} 不允许直接变成 ${to}`);
    }
    const item = db.stock.find((s) => s.sku === picking.sku);
    if (to === 'APPROVED') {
      const available = item.onHand - item.reserved;
      if (picking.qty > available) throw new BizError('insufficient_stock', `可用 ${available} 不够 ${picking.qty}`);
      item.reserved += picking.qty;
    }
    if (to === 'SHIPPED') {
      item.reserved -= picking.qty;
      item.onHand -= picking.qty;
    }
    if (to === 'CANCELED' && from === 'APPROVED') {
      item.reserved -= picking.qty;
    }
    picking.status = to;
    picking.updatedAt = now();
    emit(picking, from, to, who);
    return picking;
  }

  return {
    reset() {
      db = fresh();
      return this.snapshot();
    },
    snapshot() {
      return {
        stock: db.stock.map((s) => ({ ...s, available: s.onHand - s.reserved })),
        pickings: db.pickings.map((p) => ({ ...p })),
        events: db.events.map((e) => ({ ...e })),
      };
    },
    create({ sku, qty, owner }) {
      const item = db.stock.find((s) => s.sku === sku);
      if (!item) throw new BizError('unknown_sku', `没有这个 SKU：${sku}`);
      const n = Number(qty);
      if (!Number.isInteger(n) || n <= 0) throw new BizError('invalid_argument', 'qty 必须是正整数');
      const picking = { id: `P${db.nextId++}`, sku, qty: n, status: 'DRAFT', owner, updatedAt: now() };
      db.pickings.push(picking);
      emit(picking, null, 'DRAFT', owner);
      return { ...picking };
    },
    transition(id, to, who, role) {
      const p = findPicking(id);
      // 归属校验：制单员只能动自己的单，审批员不受此限。
      if (role !== 'manager' && p.owner !== who) {
        throw new BizError('not_owner', `出库单 ${id} 不属于 ${who}`);
      }
      if (to === 'APPROVED' || to === 'SHIPPED') {
        if (role !== 'manager') throw new BizError('forbidden', '只有审批员能审批或发货');
      }
      return { ...move(p, to, who) };
    },
    list(owner) {
      return db.pickings.filter((p) => p.owner === owner).map((p) => ({ ...p }));
    },
  };
}

class BizError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------- 适配器

export function createAdapter(options = {}) {
  const backend = options.backend ?? createBackend();
  const runs = new Map();
  let seq = 0;

  const manifest = async () => JSON.parse(JSON.stringify(MANIFEST));

  async function reset({ seed } = {}) {
    seq += 1;
    const runId = `wh-${seq}`;
    backend.reset(seed);
    // roleBindings 必须单射：三个角色绑到三个不同身份。
    // 两个角色指向同一个账号，等于让「换个身份再来一次」这类案例静默失效。
    const roleBindings = { clerk: 'zhang', clerk2: 'li', manager: 'wang' };
    runs.set(runId, { roleBindings });
    return { runId, state: backend.snapshot(), roleBindings };
  }

  async function observe(runId) {
    if (!runs.has(runId)) return { state: null, missingScopes: MANIFEST.scopes };
    // 投影成规范视图。键名可以自定义，但一旦定下来就别改——
    // 断言写在视图上，视图漂移等于断言漂移。
    return { state: backend.snapshot(), missingScopes: [] };
  }

  async function execute(runId, action) {
    const ctx = runs.get(runId);
    if (!ctx) return { outcome: 'infra_error', error: { code: 'no_run', message: `运行 ${runId} 不存在` } };

    // 身份只来自案例的 as。找不到就明确拒绝，绝不回落到默认身份——
    // 静默回落会让「用 B 的身份做」被悄悄执行成「用 A 的身份做」，
    // 案例判 pass，但它测的不是它声称的那件事。docs/FINDING-001.md 就是这个坑。
    if (action.as !== undefined && !ROLES.includes(action.as)) {
      return { outcome: 'rejected', error: { code: 'unknown_role', message: `角色 ${action.as} 不在 manifest.roles 里` } };
    }
    const role = action.as ?? 'clerk';
    const who = ctx.roleBindings[role];
    const args = action.arguments ?? {};

    try {
      switch (action.capability) {
        case 'stock.list':
          return { outcome: 'applied', payload: { stock: backend.snapshot().stock } };

        case 'picking.create': {
          const p = backend.create({ sku: args.sku, qty: args.qty, owner: who });
          return { outcome: 'applied', payload: { pickingId: p.id, status: p.status } };
        }

        case 'picking.list':
          return { outcome: 'applied', payload: { pickings: backend.list(who) } };

        case 'picking.submit':
        case 'picking.approve':
        case 'picking.ship':
        case 'picking.cancel': {
          // 能力名到状态名不是机械的 toUpperCase：submit → SUBMITTED。
          // 这类映射表就该显式写出来，别指望字符串变形对得上。
          const to = { submit: 'SUBMITTED', approve: 'APPROVED', ship: 'SHIPPED', cancel: 'CANCELED' }[
            action.capability.split('.')[1]
          ];
          const p = backend.transition(args.pickingId, to, who, role);
          return { outcome: 'applied', payload: { pickingId: p.id, status: p.status } };
        }

        case 'stock.adjust':
          // manifest 里声明为 inferred，这里就该老实返回 unsupported。
          // 别为了「看起来支持」硬编一个，那会让覆盖缺口变成假绿。
          return { outcome: 'unsupported', error: { code: 'not_implemented', message: '盘点调整尚未接线' } };

        default:
          return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
      }
    } catch (e) {
      if (e instanceof BizError) return { outcome: 'rejected', error: { code: e.code, message: e.message } };
      return { outcome: 'infra_error', error: { code: 'adapter_error', message: String(e && e.message) } };
    }
  }

  async function close(runId) {
    runs.delete(runId);
  }

  return { manifest, reset, observe, execute, close };
}

export default createAdapter;

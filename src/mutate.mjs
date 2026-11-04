/**
 * 语义变异体：把"实现能错的方式"变成可执行的东西。
 *
 * 一个变异体 = 正确实现的一份副本，只在一个地方被悄悄改坏。
 * 它用来回答一个断言必须回答的问题：**你能把它抓出来吗？**
 *
 * 分两层：
 *  - state 层：只篡改 observe() 返回的规范视图。终态写错、金额差一分、
 *    流水被吞、多出一条不该有的订单 —— 这些都不会让判决变红，
 *    除非有断言真的盯住了那一点。
 *  - execute 层：篡改动作的结局。越权放行、非法迁移不拒。
 *    这类错误靠"负例步"抓，靠终态断言抓不到。
 */

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

function wrapState(inner, tamper) {
  return {
    ...inner,
    async observe(runId, scopes) {
      const res = await inner.observe(runId, scopes);
      const state = clone(res.state);
      tamper(state);
      return { ...res, state };
    },
  };
}

function wrapExecute(inner, tamper) {
  return {
    ...inner,
    async execute(runId, action) {
      const patched = tamper(action);
      const res = await inner.execute(runId, patched ?? action);
      return res;
    },
  };
}

function wrapExecuteAfter(inner, after) {
  return {
    ...inner,
    async execute(runId, action) {
      const res = await inner.execute(runId, action);
      return after(action, res) ?? res;
    },
  };
}

export const MUTATIONS = [
  {
    id: 'm-money-off-by-cent',
    title: '金额少一分',
    level: 'state',
    symptom: '总额被四舍五入错，或者用了单价而不是小计',
    wrap: (a) => wrapState(a, (s) => {
      for (const o of s.orders ?? []) {
        if (typeof o.totalAmount === 'number') o.totalAmount = Math.round((o.totalAmount - 0.01) * 100) / 100;
      }
    }),
  },
  {
    id: 'm-status-frozen',
    title: '状态永远停在初始值',
    level: 'state',
    symptom: '状态机没接上，每次读都返回 PENDING',
    wrap: (a) => wrapState(a, (s) => {
      for (const o of s.orders ?? []) o.status = 'PENDING';
    }),
  },
  {
    id: 'm-history-empty',
    title: '事件流水被吞掉',
    level: 'state',
    symptom: '迁移发生了但没记日志（或被清理任务删了）',
    wrap: (a) => wrapState(a, (s) => {
      s.status_log = [];
    }),
  },
  {
    id: 'm-extra-foreign-order',
    title: '列表多出别人的订单',
    level: 'state',
    symptom: '查询没按当前用户过滤，别人的单混进来',
    wrap: (a) => wrapState(a, (s) => {
      if (!Array.isArray(s.orders) || s.orders.length === 0) return;
      const ghost = clone(s.orders[0]);
      ghost.id = (ghost.id ?? 0) + 500000;
      ghost.username = 'somebody-else';
      s.orders.push(ghost);
    }),
  },
  {
    id: 'm-foreign-write-allowed',
    title: '越权写被放行',
    level: 'execute',
    symptom: '归属校验漏了，第二个顾客能操作别人的单',
    wrap: (a) => wrapExecute(a, (action) => {
      if (action.as !== 'customer2') return null;
      return { ...action, as: 'customer' };
    }),
  },
  {
    id: 'm-no-reject',
    title: '该拒的不拒',
    level: 'execute',
    symptom: '状态机校验被注释掉了，非法迁移一律放行',
    wrap: (a) => wrapExecuteAfter(a, (action, res) => {
      if (res.outcome !== 'rejected') return null;
      const orderId = action.arguments?.orderId ?? action.bindings?.orderId ?? null;
      return { outcome: 'applied', payload: { orderId }, identity: res.identity };
    }),
  },
];

export function mutate(adapter, id) {
  const m = MUTATIONS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown mutation: ${id}`);
  return m.wrap(adapter);
}

export function mutationIds() {
  return MUTATIONS.map((m) => m.id);
}

export function describeMutations() {
  return MUTATIONS.map((m) => ({ id: m.id, title: m.title, level: m.level, symptom: m.symptom }));
}

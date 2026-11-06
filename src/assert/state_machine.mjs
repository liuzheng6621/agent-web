// state_machine：状态机合法性——不是「走过哪些态」，而是「只许走这些边」。
//
// status_transition 只能断言「某条边出现过」。它说不出「不许从 PENDING 直接到 PICKED」，
// 因为那句话不是关于出现过的边，而是关于**所有可能被走的边**。
//
// 三条硬边界：
//   1. 没有声明 transitions → unknown/not_declared，不是默默通过
//      （没声明就没约束，判真等于假装查过了）
//   2. 观测到的状态不在 states 里 → unknown/unknown_state，不判假
//      （那是声明漏了一个态，不是实现走错了）
//   3. 首态与末态不参与合法性检查：它们由案例的起点与终点决定，不是「迁移」

const TRUE = 'true';
const FALSE = 'false';
const UNKNOWN = 'unknown';
const ok = (status, code, message, extra = {}) => ({ status, code, message, ...extra });

/**
 * 两种取序列的方式，因为「状态机」在两个地方都成立：
 *
 *   walk='snapshots'（默认）：跟着某**一个实体**在每一步快照里的状态走。
 *     适合「订单从下单到取餐」——同一个订单的行在每一步都在。
 *
 *   walk='rows'：把**流水集合自己**当序列，每行取 path 那一列。
 *     适合「事件日志只许按这四条边走」——日志本身就是边的清单，
 *     快照里只看第一行会漏掉后面所有行（追加在末尾的那条多余的边永远看不见）。
 */
function seqOf(ctx, spec, path, walk) {
  const raw = [];
  if (walk === 'rows') {
    const sel = typeof spec === 'object' && spec ? spec : { collection: spec };
    const rows = sel.collection && ctx.final ? ctx.final[sel.collection] : null;
    if (!Array.isArray(rows)) return [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row);
      if (v === undefined) continue;
      raw.push(v);
    }
    return raw.filter((v, i) => i === 0 || v !== raw[i - 1]);
  }
  for (const step of ctx.trace ?? []) {
    const sel = typeof spec === 'object' && spec ? spec : { collection: spec };
    const rows = sel.collection && step.stateAfter ? step.stateAfter[sel.collection] : null;
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const row = sel.index !== undefined ? rows[sel.index] : rows[0];
    if (!row || typeof row !== 'object') continue;
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row);
    if (v === undefined) continue;
    raw.push(v);
  }
  return raw.filter((v, i) => i === 0 || v !== raw[i - 1]);
}

export function state_machine(a, ctx) {
  const path = a.path ?? 'status';
  const declared = a.transitions;
  if (!Array.isArray(declared) || declared.length === 0) {
    return ok(UNKNOWN, 'not_declared', '没有声明 transitions：没声明就没约束，判真等于假装查过了');
  }
  const states = Array.isArray(a.states) ? a.states : null;
  const seq = seqOf(ctx, a.selector, path, a.walk ?? 'snapshots');
  if ((a.walk ?? 'snapshots') === 'rows' && seq.length === 0) {
    return ok(UNKNOWN, 'missing_observation', '终态视图里取不到那个集合的行，看不见就不判');
  }
  if (seq.length === 0) {
    return ok(UNKNOWN, 'missing_observation', '轨迹里取不到状态序列，看不见就不判');
  }

  if (states) {
    const outside = seq.filter((v) => !states.includes(v));
    if (outside.length > 0) {
      return ok(
        UNKNOWN,
        'unknown_state',
        `观测到未声明的状态 ${[...new Set(outside)].join('、')}：那是声明漏了态，不是实现走错了`,
      );
    }
  }

  const allowed = new Set(declared.map(([f, t]) => `${f}=>${t}`));
  const illegal = [];
  for (let i = 1; i < seq.length; i += 1) {
    const edge = `${seq[i - 1]}=>${seq[i]}`;
    if (!allowed.has(edge)) illegal.push(edge);
  }
  if (illegal.length > 0) {
    return ok(
      FALSE,
      'illegal_transition',
      `走了未声明的迁移 ${illegal.join(', ')}；实际 ${seq.join(' -> ')}，允许 ${[...allowed].join(', ')}`,
      { illegal },
    );
  }
  return ok(TRUE, 'ok', `全部迁移都在声明内：${seq.join(' -> ')}`);
}

export const STATE_MACHINE_VERSION = 'agent-web/state-machine-1';

// 一个**诚实**的适配器：它的两条写能力角色集合不同。
// 用来钉住探针「角色真的生效」这一项的挑人规则——
// 拿第一条能力挑出来的局外人去套第二条能力，会把诚实实现诬告成越权。
//
// admin.purge  只允许 admin
// public.post  允许 anonymous 与 member（admin 反而不行）
//
// 旧实现从 admin.purge 挑出 outsider='anonymous'，然后拿它去打 public.post，
// public.post 本来就允许 anonymous ⇒ applied ⇒ 判「越权能过」。这不成立。

export function createAdapter() {
  const runs = new Map();
  let seq = 0;

  const caps = [
    { id: 'admin.purge', kind: 'write', args: {}, roles: ['admin'], evidence_level: 'observed' },
    { id: 'public.post', kind: 'write', args: {}, roles: ['anonymous', 'member'], evidence_level: 'observed' },
    { id: 'notes.list', kind: 'read', args: {}, roles: ['anonymous', 'member', 'admin'], evidence_level: 'observed' },
  ];

  const viewOf = (notes) => ({ notes: notes.map((n) => ({ id: n.id, body: n.body })) });

  return {
    async manifest() {
      return {
        adapter: 'mixed-roles',
        adapter_version: '1.0.0',
        reset_strategy: 'identity',
        roles: ['anonymous', 'member', 'admin'],
        scopes: ['notes'],
        capabilities: caps,
        view: {
          version: 'agent-web/view/1',
          collections: { notes: { kind: 'list', semantics: '帖子' } },
        },
      };
    },
    async reset() {
      seq += 1;
      const notes = [{ id: 1, body: 'seed' }];
      runs.set(seq, notes);
      return {
        runId: `r${seq}`,
        state: viewOf(notes),
        roleBindings: { anonymous: null, member: 'm1', admin: 'a1' },
      };
    },
    async observe(runId) {
      const notes = runs.get(Number(String(runId).replace(/\D/g, '')));
      if (!notes) return { state: null, missingScopes: ['notes'] };
      return { state: viewOf(notes), missingScopes: [] };
    },
    async execute(runId, action) {
      const cap = caps.find((c) => c.id === action.capability);
      if (!cap) return { outcome: 'rejected', error: { code: 'unknown_capability', message: '没这条能力' } };
      if (!cap.roles.includes(action.as)) {
        return { outcome: 'rejected', error: { code: 'forbidden', message: `${action.as} 无权限` } };
      }
      if (cap.kind === 'read') return { outcome: 'applied', payload: { ok: true } };
      const notes = runs.get(Number(String(runId).replace(/\D/g, ''))) || [];
      if (cap.id === 'admin.purge') notes.length = 0;
      else notes.push({ id: notes.length + 1, body: 'new' });
      return { outcome: 'applied', payload: { ok: true } };
    },
    async close() {},
  };
}

export default { createAdapter };

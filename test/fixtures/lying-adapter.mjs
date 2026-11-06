// 三处谎，用来证明探针抓得住：声明了却不存在、忽略角色、读偷偷写。
const STATE = { notes: [] };

export function createAdapter() {
  let seq = 0;
  const state = () => ({ notes: STATE.notes.map((n) => ({ id: n.id, text: n.text })) });
  return {
    async manifest() {
      return {
        adapter: 'lying',
        adapter_version: '1.0.0',
        reset_strategy: 'identity',
        canonical_view: { version: 'agent-web/view/1', semantics: 'snapshot', collections: {
          notes: { kind: 'list', semantics: 'append-only', fields: { id: 'number', text: 'string' } },
        } },
        roles: ['reader', 'writer'],
        scopes: ['notes'],
        capabilities: [
          // 声明了 note.vanish，实现里根本没有
          { id: 'note.vanish', kind: 'write', evidence_level: 'inferred', roles: ['writer'], args: {} },
          // 只允许 writer，但实现忽略角色
          { id: 'note.create', kind: 'write', evidence_level: 'inferred', roles: ['writer'], args: { text: 'string?' } },
          // 读，但会偷偷写
          { id: 'note.list', kind: 'read', evidence_level: 'inferred', roles: ['reader', 'writer'], args: {} },
        ],
      };
    },
    async reset() {
      STATE.notes = [];
      return { runId: `lying-${++seq}`, state: state(), roleBindings: { reader: 'r1', writer: 'w1' } };
    },
    async observe() {
      return { state: state() };
    },
    async execute(runId, action) {
      if (action.capability === 'note.create') {
        STATE.notes.push({ id: STATE.notes.length + 1, text: action.arguments?.text ?? 'x' });
        return { outcome: 'applied', payload: {} };
      }
      if (action.capability === 'note.list') {
        // 读偷偷写：每次读都追加一行
        STATE.notes.push({ id: STATE.notes.length + 1, text: 'audit' });
        return { outcome: 'applied', payload: { notes: state().notes } };
      }
      return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: `${action.capability} 没有实现` } };
    },
    async close() {},
  };
}

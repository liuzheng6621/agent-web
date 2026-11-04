// 账本域 · 实现 A：内部一律用整数分（cents），读的时候才换成元。
// 与 adapter-b 故意用不同的内部表示：A 是「一笔交易存全部借贷分录、余额每次现算」，
// B 是「每个账户各自记账、余额增量维护」。同一份案例必须两边一致。
import { validateManifest } from '../../src/adapter/contract.mjs';

export const MANIFEST = {
  adapter: 'ledger-a',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  description: '复式记账账本（整数分表示，余额现算）',
  scopes: ['accounts', 'transactions', 'trial'],
  roles: ['clerk'],
  view: {
    version: 'agent-web/view/1',
    collections: {
      accounts: {
        kind: 'list',
        required: ['id', 'name', 'type', 'balance'],
        semantics: '本次运行创建的账户',
      },
      transactions: {
        kind: 'list',
        required: ['id', 'description', 'entries', 'total'],
        semantics: '本次运行记账的交易',
      },
      trial: {
        kind: 'list',
        required: ['accountId', 'debits', 'credits', 'balance'],
        semantics: '试算平衡表',
      },
    },
  },
  capabilities: [
    { id: 'account.create', kind: 'write', evidence_level: 'validated', roles: ['clerk'] },
    { id: 'transaction.post', kind: 'write', evidence_level: 'validated', roles: ['clerk'] },
    { id: 'accounts.list', kind: 'read', evidence_level: 'validated', roles: ['clerk'] },
    { id: 'transactions.list', kind: 'read', evidence_level: 'validated', roles: ['clerk'] },
    { id: 'trial.balance', kind: 'read', evidence_level: 'validated', roles: ['clerk'] },
  ],
};

const yuan = (cents) => cents / 100;
const clone = (v) => structuredClone(v);

export function createLedgerA() {
  const runs = new Map();
  let serial = 0;

  function blank(runId) {
    return { runId, accounts: new Map(), txs: [], nextAcc: 1, nextTx: 1 };
  }

  function balances(map, run) {
    const out = new Map();
    for (const id of run.accounts.keys()) out.set(id, 0);
    for (const tx of run.txs) {
      for (const e of tx.entries) {
        const sign = e.direction === 'debit' ? 1 : -1;
        out.set(e.accountId, (out.get(e.accountId) ?? 0) + sign * e.amountCents);
      }
    }
    return out;
  }

  async function manifest() { return clone(MANIFEST); }

  async function reset() {
    serial += 1;
    const runId = `ledger-a-${serial}`;
    runs.set(runId, blank(runId));
    return {
      runId,
      state: { accounts: [], transactions: [], trial: [] },
      roleBindings: { clerk: `clerk-${serial}` },
    };
  }

  async function observe(runId) {
    const run = runs.get(runId);
    if (!run) return { state: null, missingScopes: MANIFEST.scopes };
    const bal = balances(null, run);
    const accounts = [...run.accounts.values()].map((a) => ({
      id: a.id, name: a.name, type: a.type, balance: yuan(bal.get(a.id) ?? 0),
    }));
    const transactions = run.txs.map((t) => ({
      id: t.id,
      description: t.description,
      entries: t.entries.map((e) => ({ accountId: e.accountId, direction: e.direction, amount: yuan(e.amountCents) })),
      total: yuan(t.entries.reduce((s, e) => s + (e.direction === 'debit' ? e.amountCents : -e.amountCents), 0)),
    }));
    const trial = [...run.accounts.values()].map((a) => {
      let d = 0; let c = 0;
      for (const t of run.txs) for (const e of t.entries) if (e.accountId === a.id) {
        if (e.direction === 'debit') d += e.amountCents; else c += e.amountCents;
      }
      return { accountId: a.id, debits: yuan(d), credits: yuan(c), balance: yuan(d - c) };
    });
    return { state: { accounts, transactions, trial }, missingScopes: [] };
  }

  async function execute(runId, action) {
    const run = runs.get(runId);
    if (!run) return { outcome: 'infra_error', error: { code: 'no_run', message: 'run not found' } };
    const cap = MANIFEST.capabilities.find((c) => c.id === action.capability);
    const reject = (code, message) => ({ outcome: 'rejected', error: { code, message } });
    if (!cap) return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
    if (!cap.roles.includes(action.as)) return reject('forbidden', `${action.as} cannot ${action.capability}`);
    const args = action.arguments ?? {};

    if (action.capability === 'account.create') {
      if (!args.name) return reject('invalid_argument', 'name required');
      const id = run.nextAcc++;
      run.accounts.set(id, { id, name: String(args.name), type: String(args.type ?? 'asset') });
      return { outcome: 'applied', identity: run.runId, payload: { accountId: id } };
    }

    if (action.capability === 'transaction.post') {
      const entries = args.entries;
      if (!Array.isArray(entries) || entries.length < 2) return reject('invalid_argument', 'entries 至少两条');
      let d = 0; let c = 0;
      for (const e of entries) {
        if (!e || e.direction !== 'debit' && e.direction !== 'credit') return reject('invalid_argument', 'direction 必须是 debit 或 credit');
        const n = Number(e.amount);
        if (!Number.isFinite(n) || n <= 0) return reject('invalid_amount', '金额必须为正数');
        if (!run.accounts.has(Number(e.accountId))) return reject('account_not_found', `账户 ${e.accountId} 不存在`);
        if (e.direction === 'debit') d += Math.round(n * 100); else c += Math.round(n * 100);
      }
      if (d !== c) return reject('unbalanced', `借贷不平：借方 ${d} 分，贷方 ${c} 分`);
      const id = run.nextTx++;
      run.txs.push({
        id,
        description: String(args.description ?? ''),
        entries: entries.map((e) => ({ accountId: Number(e.accountId), direction: e.direction, amountCents: Math.round(Number(e.amount) * 100) })),
      });
      return { outcome: 'applied', identity: run.runId, payload: { transactionId: id } };
    }

    if (cap.kind === 'read') return { outcome: 'applied', identity: run.runId, payload: {} };
    return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
  }

  async function close(runId) { runs.delete(runId); }

  return { manifest, reset, observe, execute, close };
}

export function createAdapter() { return createLedgerA(); }
export function validateLedgerA() { return validateManifest(MANIFEST); }

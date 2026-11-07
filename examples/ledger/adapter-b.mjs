// 账本域 · 实现 B：内部用「两位小数的字符串」，每个账户挂自己的分录，余额增量维护。
// 这份是故意跟 adapter-a 走不同路线：A 存交易、余额现算；B 存分录、余额累加。
// 同一份案例必须两边判得一样——不一致就说明案例在测实现细节，不是在测契约。
import { validateManifest } from '../../src/adapter/contract.mjs';

export const MANIFEST = {
  adapter: 'ledger-b',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  clock_policies: ['frozen'],   // 纯计算，没有时间维度
  description: '复式记账账本（字符串表示，分录挂在账户上，余额增量维护）',
  scopes: ['accounts', 'transactions', 'trial'],
  roles: ['clerk'],
  view: {
    version: 'agent-web/view/1',
    collections: {
      accounts: { kind: 'list', required: ['id', 'name', 'type', 'balance'], semantics: '本次运行创建的账户' },
      transactions: { kind: 'list', required: ['id', 'description', 'entries', 'total'], semantics: '本次运行记账的交易' },
      trial: { kind: 'list', required: ['accountId', 'debits', 'credits', 'balance'], semantics: '试算平衡表' },
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

const clone = (v) => structuredClone(v);

/** 字符串金额 → 分。故意不复用 adapter-a 的写法。 */
function toCents(text) {
  const s = String(text).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [int, frac = ''] = body.split('.');
  const cents = Number(int) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

function toYuan(cents) {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return Number(`${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`);
}

export function createLedgerB() {
  const runs = new Map();
  let serial = 0;

  async function manifest() { return clone(MANIFEST); }

  async function reset() {
    serial += 1;
    const runId = `ledger-b-${serial}`;
    runs.set(runId, { runId, accounts: new Map(), postings: [], nextAcc: 1, nextTx: 1 });
    return {
      runId,
      state: { accounts: [], transactions: [], trial: [] },
      roleBindings: { clerk: `clerk-${serial}` },
    };
  }

  async function observe(runId) {
    const run = runs.get(runId);
    if (!run) return { state: null, missingScopes: MANIFEST.scopes };

    const per = new Map();
    for (const p of run.postings) {
      if (!per.has(p.accountId)) per.set(p.accountId, { d: 0, c: 0 });
      const bucket = per.get(p.accountId);
      if (p.direction === 'debit') bucket.d += p.cents; else bucket.c += p.cents;
    }

    const accounts = [...run.accounts.values()].map((a) => {
      const b = per.get(a.id) ?? { d: 0, c: 0 };
      return { id: a.id, name: a.name, type: a.type, balance: toYuan(b.d - b.c) };
    });

    const orders = [...new Set(run.postings.map((p) => p.txId))].sort((x, y) => x - y);
    const transactions = orders.map((txId) => {
      const mine = run.postings.filter((p) => p.txId === txId);
      const total = mine.reduce((s, p) => s + (p.direction === 'debit' ? p.cents : -p.cents), 0);
      return {
        id: txId,
        description: mine[0]?.description ?? '',
        entries: mine.map((p) => ({ accountId: p.accountId, direction: p.direction, amount: toYuan(p.cents) })),
        total: toYuan(total),
      };
    });

    const trial = [...run.accounts.values()].map((a) => {
      const b = per.get(a.id) ?? { d: 0, c: 0 };
      return { accountId: a.id, debits: toYuan(b.d), credits: toYuan(b.c), balance: toYuan(b.d - b.c) };
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
      const staged = [];
      for (const e of entries) {
        const cents = toCents(e?.amount);
        if (cents === null) return reject('invalid_amount', `${e?.amount} 不是合法金额`);
        if (cents <= 0) return reject('invalid_amount', '金额必须为正数');
        if (e.direction !== 'debit' && e.direction !== 'credit') return reject('invalid_argument', 'direction 必须是 debit 或 credit');
        if (!run.accounts.has(Number(e.accountId))) return reject('account_not_found', `账户 ${e.accountId} 不存在`);
        staged.push({ accountId: Number(e.accountId), direction: e.direction, cents });
        if (e.direction === 'debit') d += cents; else c += cents;
      }
      if (d !== c) return reject('unbalanced', `借贷不平：借方 ${toYuan(d)}，贷方 ${toYuan(c)}`);
      const txId = run.nextTx++;
      for (const s of staged) {
        run.postings.push({ ...s, txId, description: String(args.description ?? '') });
      }
      return { outcome: 'applied', identity: run.runId, payload: { transactionId: txId } };
    }

    if (cap.kind === 'read') return { outcome: 'applied', identity: run.runId, payload: {} };
    return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
  }

  async function close(runId) { runs.delete(runId); }

  return { manifest, reset, observe, execute, close };
}

export function createAdapter() { return createLedgerB(); }
export function validateLedgerB() { return validateManifest(MANIFEST); }

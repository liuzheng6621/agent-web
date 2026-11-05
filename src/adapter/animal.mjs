/**
 * 流浪动物保护追踪系统适配器（真实 HTTP，Spring Boot 3 + MySQL）。
 *
 * 这是「第三个域」的第二个实现：形状与咖啡店完全不同 ——
 * Spring Page 信封（`{content,totalElements,totalPages}` 而非 `{list}`）、
 * 大写状态（PENDING/APPROVED）、三个角色、以及一条审批链。
 *
 * reset 走身份隔离：三个预置账号（admin/volunteer/user）各拿一枚 JWT。
 * 登录有每分钟限流，所以 token 缓存在 `.agent-web/animal-tokens.json`：
 * 取 token 是基础设施，不该让每个案例都去撞限流。
 *
 * 它同时是一个反例库：这个后端的审批接口只要求「已登录」，
 * 没要求 ADMIN —— `cases/animal/adoption-approve-forbidden` 就是为这条写的。
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from './contract.mjs';

export const CANONICAL_VIEW = 'agent-web/canonical-view';

const ACCOUNTS = {
  admin: { username: 'admin', password: 'admin123' },
  volunteer: { username: 'volunteer', password: 'volunteer123' },
  user: { username: 'user', password: 'user123' },
};

const TOKEN_FILE = path.join('.agent-web', 'animal-tokens.json');
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000;

const baseUrl = () => (process.env.ANIMAL_BASE_URL || 'http://127.0.0.1:8181').replace(/\/+$/, '');

class Infra extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function readTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeTokens(all) {
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(all, null, 2));
  } catch {
    /* 缓存写不进去不影响正确性：下次重新登录而已 */
  }
}

async function httpCall(method, p, { token, body, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseUrl()}${p}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: ctl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: r.status, json, text };
  } catch (e) {
    throw new Infra('infrastructure_error', `连不上 ${baseUrl()}${p}：${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP 状态 → 适配器结果。401 是基础设施问题（token 该由适配器自己管），403 是业务拒绝。 */
function classify(r, payload) {
  if (r.status === 401) throw new Infra('infrastructure_error', `401 未授权：${r.json?.message ?? ''}`);
  if (r.status >= 500) throw new Infra('infrastructure_error', `${r.status}：${r.json?.message ?? r.text.slice(0, 120)}`);
  if (r.status >= 200 && r.status < 300 && r.json?.success !== false) {
    return { outcome: 'applied', payload };
  }
  return {
    outcome: 'rejected',
    code: r.json?.error || r.json?.message || `http_${r.status}`,
    status: r.status,
  };
}

const pageOf = (json) => {
  const d = json?.data ?? {};
  return { rows: Array.isArray(d.content) ? d.content : [], total: d.totalElements ?? null, pages: d.totalPages ?? null, size: d.size ?? null };
};

const normAnimal = (a) => ({
  id: a?.id ?? null,
  name: a?.name ?? null,
  species: a?.species ?? null,
  status: a?.status ?? null,
  deviceId: a?.deviceId ?? null,
  color: a?.color ?? null,
});

const normAdoption = (a) => ({
  id: a?.id ?? null,
  animalId: a?.animalId ?? null,
  animalName: a?.animalName ?? null,
  applicantName: a?.applicantName ?? null,
  status: a?.status ?? null,
  reviewer: a?.reviewer ?? null,
  reviewComment: a?.reviewComment ?? null,
});

const normUser = (u) => ({
  id: u?.id ?? null,
  username: u?.username ?? null,
  role: u?.role ?? null,
  points: u?.points ?? null,
});

const MANIFEST = {
  adapter: 'animal',
  adapter_version: '1.0.0',
  reset_strategy: 'identity',
  canonical_view: CANONICAL_VIEW,
  description: '流浪动物保护追踪系统（Spring Boot 3 + MySQL）：动物档案 / 领养审批 / 用户与积分',
  scopes: ['animals', 'adoption_applications', 'users'],
  // 这个后端没有「实体事件流」，只有审计日志（且按操作记，不是按实体状态迁移记）。
  // 不声明 events_complete，事件类断言就会退回 unknown，而不是对着空集合判真。
  events_complete: false,
  view: {
    version: 'agent-web/view/1',
    collections: {
      animals: { kind: 'list', required: ['id', 'name', 'species', 'status'], semantics: '动物档案' },
      adoption_applications: {
        kind: 'list',
        required: ['id', 'animalId', 'status'],
        semantics: '领养申请（PENDING/APPROVED/REJECTED）',
      },
      users: { kind: 'list', required: ['id', 'username', 'role'], semantics: '账号' },
    },
  },
  roles: ['admin', 'volunteer', 'user'],
  reset_note:
    'identity：三个预置账号各拿一枚 JWT（admin/admin123、volunteer/volunteer123、user/user123），token 缓存在 .agent-web/animal-tokens.json 以避开登录限流；不清库、不回滚。',
  capabilities: [
    { id: 'animals.list', kind: 'read', evidence_level: 'validated', roles: ['admin', 'volunteer', 'user'], http: 'GET /api/v1/animals?page=&size=' },
    { id: 'animals.get', kind: 'read', evidence_level: 'validated', roles: ['admin', 'volunteer', 'user'], http: 'GET /api/v1/animals/{id}', args: { id: 'integer' } },
    { id: 'animals.by_device', kind: 'read', evidence_level: 'validated', roles: ['admin', 'volunteer', 'user'], http: 'GET /api/v1/animals/device/{deviceId}', args: { deviceId: 'string' } },
    { id: 'adoptions.list', kind: 'read', evidence_level: 'validated', roles: ['admin', 'volunteer', 'user'], http: 'GET /api/v1/adoptions?page=&size=&status=' },
    { id: 'adoptions.get', kind: 'read', evidence_level: 'validated', roles: ['admin', 'volunteer', 'user'], http: 'GET /api/v1/adoptions/{id}', args: { applicationId: 'integer' } },
    {
      id: 'adoptions.create',
      kind: 'write',
      evidence_level: 'validated',
      roles: ['user', 'volunteer', 'admin'],
      http: 'POST /api/v1/adoptions',
      args: { animalId: 'integer', applicantName: 'string' },
    },
    {
      id: 'adoptions.approve',
      kind: 'write',
      evidence_level: 'validated',
      roles: ['admin'],
      http: 'PUT /api/v1/adoptions/{id}/approve',
      args: { applicationId: 'integer' },
      note: '按业务预期只有 admin 能做；真实后端只要求「已登录」——见 cases/animal/adoption-approve-forbidden',
    },
    {
      id: 'adoptions.reject',
      kind: 'write',
      evidence_level: 'validated',
      roles: ['admin'],
      http: 'PUT /api/v1/adoptions/{id}/reject',
      args: { applicationId: 'integer' },
    },
  ],
};

export function createAnimalAdapter(options = {}) {
  const tokens = new Map();
  // 本轮开始前最大的领养申请 id：这个后端不清理历史行，不切基线 index 0 会指到上一轮。
  let baselineAdoptionId = 0;
  const runs = new Map();
  let seq = 0;
  let cached = readTokens();

  async function login(role, { force = false } = {}) {
    const acc = ACCOUNTS[role];
    if (!acc) throw new Infra('infrastructure_error', `未知角色：${role}`);
    if (!force && tokens.has(role)) return tokens.get(role);
    const saved = cached[role];
    if (!force && saved && Date.now() - saved.at < TOKEN_TTL_MS) {
      tokens.set(role, saved.token);
      return saved.token;
    }
    const r = await httpCall('POST', '/api/v1/auth/login', { body: acc });
    const token = r.json?.data?.token;
    if (!token) {
      throw new Infra(
        'infrastructure_error',
        `角色 ${role} 登录失败：${r.json?.message ?? r.status}（登录有每分钟限流，连续跑请等一分钟）`,
      );
    }
    tokens.set(role, token);
    cached = { ...cached, [role]: { token, at: Date.now() } };
    writeTokens(cached);
    return token;
  }

  function tokenOf(ctx, role) {
    const t = tokens.get(role);
    if (!t) throw new Infra('infrastructure_error', `角色 ${role} 还没登录（先 reset）`);
    return t;
  }


  async function readState() {
    const token = tokenOf(null, 'admin');
    const animals = pageOf((await httpCall('GET', '/api/v1/animals?page=1&size=200', { token })).json);
    const adoptions = pageOf((await httpCall('GET', '/api/v1/adoptions?page=1&size=200', { token })).json);
    const users = pageOf((await httpCall('GET', '/api/v1/users?page=1&size=200', { token })).json);
    // 这个后端不会清理历史数据：不切出「本轮新增的」行，index 0 永远是上一轮的行。
    const mine = adoptions.rows.filter((r) => Number(r.id) > Number(baselineAdoptionId || 0));
    return {
      animals: animals.rows.map(normAnimal),
      adoption_applications: mine.map(normAdoption),
      users: users.rows.map(normUser),
    };
  }

  return {
    async manifest() {
      const errors = validateManifest(MANIFEST);
      if (errors.length) throw new Error(`animal 适配器 manifest 不合法：${errors.join('；')}`);
      return MANIFEST;
    },

    async reset() {
      for (const role of Object.keys(ACCOUNTS)) await login(role);
      // 记录基线：本轮开始前最大的领养申请 id（必须在登录之后、跑任何写操作之前）
      try {
        const snap = await httpCall('GET', '/api/v1/adoptions?page=1&size=200', { token: tokenOf(null, 'admin') });
        baselineAdoptionId = pageOf(snap.json).rows.reduce((mx, r) => Math.max(mx, Number(r.id) || 0), 0);
      } catch { baselineAdoptionId = 0; }
      seq += 1;
      const runId = `animal-${seq}`;
      runs.set(runId, { tokens: Object.fromEntries(Object.keys(ACCOUNTS).map((r) => [r, tokens.get(r)])) });
      return {
        runId,
        state: await readState(),
        // 每个角色一个独立真实账号：identity 复位的全部含义就在这三行。
        roleBindings: {
          admin: ACCOUNTS.admin.username,
          volunteer: ACCOUNTS.volunteer.username,
          user: ACCOUNTS.user.username,
        },
        reset_note: MANIFEST.reset_note,
      };
    },

    /** 没有需要释放的资源：token 只是字符串。留着这个方法是为了满足契约。 */
    async close() {},

    async observe(runId) {
      try {
        return { state: await readState(), missingScopes: [] };
      } catch (e) {
        return { state: null, missingScopes: MANIFEST.scopes, reason: e && e.message };
      }
    },

    async execute(runId, action) {
      const capability = action?.capability;
      const args = action?.arguments ?? {};
      const role = action?.as ?? 'user';
      const token = tokenOf(null, role);
      const who = role;

      if (capability === 'animals.list') {
        const page = Number(args.page) || 1;
        const size = Number(args.pageSize) || 20;
        const r = await httpCall('GET', `/api/v1/animals?page=${page}&size=${size}`, { token });
        const p = pageOf(r.json);
        return classify(r, { total: p.total, page, pageSize: size, hasMore: p.pages ? page < p.pages : null, animals: p.rows.map(normAnimal) });
      }

      if (capability === 'animals.get') {
        const r = await httpCall('GET', `/api/v1/animals/${encodeURIComponent(args.id)}`, { token });
        return classify(r, { animal: normAnimal(r.json?.data) });
      }

      if (capability === 'animals.by_device') {
        const r = await httpCall('GET', `/api/v1/animals/device/${encodeURIComponent(args.deviceId)}`, { token });
        return classify(r, { animal: normAnimal(r.json?.data) });
      }

      if (capability === 'adoptions.list') {
        const page = Number(args.page) || 1;
        const size = Number(args.pageSize) || 20;
        const qs = new URLSearchParams({ page: String(page), size: String(size) });
        if (args.status) qs.set('status', String(args.status));
        const r = await httpCall('GET', `/api/v1/adoptions?${qs.toString()}`, { token });
        const p = pageOf(r.json);
        return classify(r, { total: p.total, page, pageSize: size, hasMore: p.pages ? page < p.pages : null, adoption_applications: p.rows.map(normAdoption) });
      }

      if (capability === 'adoptions.get') {
        const r = await httpCall('GET', `/api/v1/adoptions/${encodeURIComponent(args.applicationId)}`, { token });
        return classify(r, { application: normAdoption(r.json?.data) });
      }

      if (capability === 'adoptions.create') {
        const body = {
          animalId: args.animalId,
          applicantName: args.applicantName ?? who,
          applicantPhone: args.applicantPhone ?? '13800000000',
          applicantEmail: args.applicantEmail ?? 'case@agent-web.local',
          reason: args.reason ?? '案例自动提交',
        };
        const r = await httpCall('POST', '/api/v1/adoptions', { token, body });
        const app = r.json?.data ?? null;
        return classify(r, { applicationId: app?.id ?? null, status: app?.status ?? null, animalId: app?.animalId ?? null });
      }

      if (capability === 'adoptions.approve' || capability === 'adoptions.reject') {
        const verb = capability === 'adoptions.approve' ? 'approve' : 'reject';
        const body = { reviewer: args.reviewer ?? who, comment: args.comment ?? '案例自动审批' };
        const r = await httpCall('PUT', `/api/v1/adoptions/${encodeURIComponent(args.applicationId)}/${verb}`, { token, body });
        const app = r.json?.data ?? null;
        return classify(r, { applicationId: args.applicationId, status: app?.status ?? null, reviewer: app?.reviewer ?? null });
      }

      return { outcome: 'unsupported', code: 'unsupported_capability' };
    },
  };
}

/** 加载器首选 `createAdapter(options)`；默认导出也留一份，方便按对象当实例用。 */
export const createAdapter = createAnimalAdapter;

export default { createAdapter: createAnimalAdapter };

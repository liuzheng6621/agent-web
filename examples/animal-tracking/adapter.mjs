import { randomUUID } from 'node:crypto';
import { validateManifest } from '../../src/adapter/contract.mjs';

const VIEW = {
  version: 'agent-web/view/1',
  collections: {
    tasks: {
      kind: 'list',
      required: ['id', 'status', 'isApproved', 'assignedToRole', 'currentVolunteers', 'rewardPoints'],
      semantics: '本次隔离运行创建的救助任务',
    },
    points: {
      kind: 'list',
      required: ['role', 'points'],
      semantics: '本次运行志愿者的积分余额',
    },
  },
};

const MANIFEST = {
  adapter: 'animal-tracking-backend',
  adapter_version: '1.0.0',
  reset_strategy: 'identity',
  description: '守望者后端的本地 HTTP 适配器：任务审核、志愿者执行与积分观测',
  reset_note: '每次 reset 注册新的居民和志愿者身份；必须连一次性 H2 测试库，不要连持久库。',
  scopes: ['tasks', 'points'],
  roles: ['reporter', 'admin', 'volunteer', 'otherVolunteer'],
  view: VIEW,
  capabilities: [
    { id: 'task.create', kind: 'write', evidence_level: 'validated', roles: ['reporter'], http: 'POST /api/v1/tasks' },
    { id: 'task.approve', kind: 'write', evidence_level: 'validated', roles: ['admin'], http: 'PUT /api/v1/tasks/{id}/approve' },
    { id: 'task.accept', kind: 'write', evidence_level: 'validated', roles: ['volunteer'], http: 'PUT /api/v1/tasks/{id}/accept' },
    { id: 'task.complete', kind: 'write', evidence_level: 'validated', roles: ['volunteer', 'otherVolunteer'], http: 'PUT /api/v1/tasks/{id}/complete' },
  ],
};

class InfraError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function configOf(options) {
  const baseUrl = options.baseUrl ?? process.env.ANIMAL_TEST_BASE_URL;
  const isolated = options.isolated ?? process.env.ANIMAL_TEST_ISOLATED === '1';
  const adminUsername = options.adminUsername ?? process.env.ANIMAL_TEST_ADMIN_USER;
  const adminPassword = options.adminPassword ?? process.env.ANIMAL_TEST_ADMIN_PASSWORD;
  if (!isolated) throw new Error('真实后端适配器只接受一次性隔离库；设置 ANIMAL_TEST_ISOLATED=1 后再运行');
  if (!baseUrl) throw new Error('必须显式设置 ANIMAL_TEST_BASE_URL；适配器没有默认目标');
  if (!adminUsername || !adminPassword) throw new Error('必须设置 ANIMAL_TEST_ADMIN_USER 和 ANIMAL_TEST_ADMIN_PASSWORD');

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('ANIMAL_TEST_BASE_URL 必须是有效 URL');
  }
  const loopback = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  if (parsed.protocol !== 'http:' || !loopback.has(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('ANIMAL_TEST_BASE_URL 必须是无凭据的本机 HTTP loopback 地址');
  }
  return { baseUrl: parsed.toString().replace(/\/$/, ''), adminUsername, adminPassword };
}

function responseMessage(body, fallback) {
  return String(body?.message ?? body?.msg ?? fallback);
}

export function createAnimalTrackingAdapter(options = {}) {
  const config = configOf(options);
  const timeoutMs = options.timeoutMs ?? 10000;
  const runs = new Map();
  const manifest = async () => structuredClone(MANIFEST);

  async function call(method, route, { body, token, headers: extraHeaders } = {}) {
    let response;
    try {
      const headers = { ...extraHeaders };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      response = await fetch(`${config.baseUrl}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new InfraError('network_error', `${method} ${route} failed: ${error?.message ?? error}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new InfraError('bad_response', `${method} ${route} returned non-JSON HTTP ${response.status}`);
    }
    return { status: response.status, ok: response.ok, payload };
  }

  function requireSuccess(result, label) {
    if (result.status === 401 || result.status === 403 || result.status === 429 || result.status >= 500) {
      throw new InfraError('upstream_error', `${label} failed with HTTP ${result.status}: ${responseMessage(result.payload, 'upstream failure')}`);
    }
    if (!result.ok || result.payload?.success !== true) {
      throw new InfraError('setup_failed', `${label} failed with HTTP ${result.status}: ${responseMessage(result.payload, 'request rejected')}`);
    }
    return result.payload;
  }

  function classify(result) {
    if (result.status === 401 || result.status === 403 || result.status === 429 || result.status >= 500) {
      return { outcome: 'infra_error', error: { code: `http_${result.status}`, message: responseMessage(result.payload, 'upstream failure') } };
    }
    if (result.ok && result.payload?.success === true) {
      return { outcome: 'applied', payload: result.payload.data };
    }
    return { outcome: 'rejected', error: { code: `http_${result.status}`, message: responseMessage(result.payload, 'business rule rejected the request') } };
  }

  async function register(ctx, role, roleValue) {
    const username = `aw_animal_${randomUUID().replaceAll('-', '').slice(0, 20)}_${role}`;
    const password = randomUUID();
    const result = await call('POST', '/api/v1/auth/register', {
      body: { username, password, role: roleValue },
    });
    const payload = requireSuccess(result, `register ${role}`);
    const user = payload.data?.user;
    const token = payload.data?.token;
    if (!user?.id || !token) throw new InfraError('bad_response', `register ${role} returned no user id/token`);
    ctx.people[role] = { id: user.id, token, username, password };
    return username;
  }

  // admin 账号是长寿命的；被测系统对 /auth/login 有限流（连续 reset 会触发 429），
  // 所以 token 按进程缓存，只有失效（401）才重新登录一次。
  let adminCache = null;

  async function loginAdmin(ctx) {
    if (adminCache) {
      ctx.people.admin = { ...adminCache, username: config.adminUsername };
      return;
    }
    const result = await call('POST', '/api/v1/auth/login', {
      body: { username: config.adminUsername, password: config.adminPassword },
    });
    if (result.status === 401 && adminCache) {
      adminCache = null;
      throw new InfraError('upstream_error', 'cached admin token rejected; rerun to re-login');
    }
    const payload = requireSuccess(result, 'login configured test admin');
    const user = payload.data?.user;
    const token = payload.data?.token;
    if (!user?.id || !token) throw new InfraError('bad_response', 'admin login returned no user id/token');
    adminCache = { id: user.id, token };
    ctx.people.admin = { ...adminCache, username: config.adminUsername };
  }

  async function reset() {
    const runId = `animal-http-${randomUUID()}`;
    const ctx = { people: {}, taskId: null };
    await loginAdmin(ctx);
    await register(ctx, 'reporter', 'CITIZEN');
    await register(ctx, 'volunteer', 'VOLUNTEER');
    await register(ctx, 'otherVolunteer', 'VOLUNTEER');
    runs.set(runId, ctx);
    const observed = await observeState(runId);
    return {
      runId,
      state: observed,
      roleBindings: Object.fromEntries(Object.entries(ctx.people).map(([role, person]) => [role, person.username])),
    };
  }

  async function observeState(runId) {
    const ctx = runs.get(runId);
    if (!ctx) throw new InfraError('no_run', `run ${runId} does not exist`);
    const tasks = [];
    if (ctx.taskId !== null) {
      const result = await call('GET', `/api/v1/tasks/${encodeURIComponent(ctx.taskId)}`, { token: ctx.people.admin.token });
      const payload = requireSuccess(result, 'read task');
      const task = payload.data;
      const assignedToRole = task.assignedTo == null
        ? null
        : Number(task.assignedTo) === Number(ctx.people.volunteer.id)
          ? 'volunteer'
          : Number(task.assignedTo) === Number(ctx.people.otherVolunteer.id)
            ? 'otherVolunteer'
            : 'unmapped';
      tasks.push({
        id: task.id,
        status: task.status,
        isApproved: task.isApproved,
        assignedToRole,
        currentVolunteers: task.currentVolunteers,
        rewardPoints: task.rewardPoints,
      });
    }
    const pointsResult = await call('GET', `/api/v1/points/user/${encodeURIComponent(ctx.people.volunteer.id)}`, {
      token: ctx.people.admin.token,
    });
    if (pointsResult.status === 401 || pointsResult.status === 403 || pointsResult.status >= 500) {
      throw new InfraError('upstream_error', `read points failed with HTTP ${pointsResult.status}`);
    }
    const pointsBody = pointsResult.payload;
    if (!pointsResult.ok || pointsBody?.success !== true || !Number.isFinite(Number(pointsBody.points))) {
      throw new InfraError('bad_response', 'points endpoint returned an invalid response');
    }
    return { tasks, points: [{ role: 'volunteer', points: Number(pointsBody.points) }] };
  }

  async function observe(runId) {
    try {
      return { state: await observeState(runId), missingScopes: [] };
    } catch (error) {
      return { state: null, missingScopes: MANIFEST.scopes, reason: error?.message ?? String(error) };
    }
  }

  async function execute(runId, action) {
    const ctx = runs.get(runId);
    if (!ctx) return { outcome: 'infra_error', error: { code: 'no_run', message: `run ${runId} does not exist` } };
    const args = action.arguments ?? {};
    const actor = ctx.people[action.as];
    if (!actor) return { outcome: 'rejected', error: { code: 'unknown_role', message: `role ${action.as} is not bound` } };

    try {
      let result;
      if (action.capability === 'task.create') {
        result = await call('POST', '/api/v1/tasks', {
          token: actor.token,
          headers: { 'X-User-Id': String(actor.id), 'X-User-Role': 'CITIZEN' },
          body: {
            title: args.title,
            description: args.description,
            type: args.type,
            location: args.location,
            priority: args.priority,
            rewardPoints: args.rewardPoints,
            maxVolunteers: args.maxVolunteers,
          },
        });
        const classified = classify(result);
        if (classified.outcome === 'applied') {
          ctx.taskId = classified.payload?.id ?? null;
          if (ctx.taskId === null) return { outcome: 'infra_error', error: { code: 'bad_response', message: 'task create returned no id' } };
          return { outcome: 'applied', identity: actor.username, payload: { taskId: ctx.taskId, status: classified.payload?.status ?? null } };
        }
        return { ...classified, identity: actor.username };
      }

      const taskId = args.taskId;
      if (taskId === undefined || taskId === null) return { outcome: 'rejected', error: { code: 'invalid_argument', message: 'taskId is required' } };
      const roleHeader = action.as === 'admin' ? 'ADMIN' : 'VOLUNTEER';
      const headers = { 'X-User-Id': String(actor.id) };
      if (action.capability === 'task.approve') {
        result = await call('PUT', `/api/v1/tasks/${encodeURIComponent(taskId)}/approve`, {
          token: actor.token,
          headers,
        });
      } else if (action.capability === 'task.accept') {
        result = await call('PUT', `/api/v1/tasks/${encodeURIComponent(taskId)}/accept`, {
          token: actor.token,
          headers,
        });
      } else if (action.capability === 'task.complete') {
        result = await call('PUT', `/api/v1/tasks/${encodeURIComponent(taskId)}/complete`, {
          token: actor.token,
          headers: { ...headers, 'X-User-Role': roleHeader },
        });
      } else {
        return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
      }
      const classified = classify(result);
      return {
        ...classified,
        identity: actor.username,
        ...(classified.outcome === 'applied'
          ? { payload: { taskId: classified.payload?.id ?? taskId, status: classified.payload?.status ?? null } }
          : {}),
      };
    } catch (error) {
      if (error instanceof InfraError) return { outcome: 'infra_error', identity: actor.username, error: { code: error.code, message: error.message } };
      return { outcome: 'infra_error', identity: actor.username, error: { code: 'adapter_error', message: String(error?.message ?? error) } };
    }
  }

  async function close(runId) {
    runs.delete(runId);
  }

  return { manifest, reset, observe, execute, close, baseUrl: config.baseUrl };
}

export function validateAnimalTrackingAdapter() {
  return validateManifest(MANIFEST);
}

export function createAdapter(options = {}) {
  return createAnimalTrackingAdapter(options);
}

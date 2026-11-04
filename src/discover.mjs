// 从一个网址开始：探测站点，生成一个「能跑的」只读适配器与一批只读案例。
//
// 这条路径能给的，和不能给的，都写在这里：
//
//   能给：这台机器现在到底有什么接口、哪些真的响应、响应是不是 JSON、是不是数组。
//         生成的适配器立刻能跑 verify，判决是「读操作不该改变任何东西」。
//   不能给：「这个业务的写操作应该保证什么」。那需要有人知道业务，机器猜不出来。
//
// 所以这里产出的每一个能力都标 evidence_level: 'inferred'，
// 每一份案例都是 draft（须 accept 才能出判决），猜不到的东西全部列出来，不装作知道了。

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const DISCOVER_VERSION = 'agent-web/discover-1';

// 常见的机器可读接口描述位置。找到就用它，找不到就走「现探」。
export const OPENAPI_CANDIDATES = [
  '/openapi.json',
  '/v3/api-docs',
  '/swagger.json',
  '/api-docs',
  '/api/openapi.json',
  '/docs/openapi.json',
  '/swagger/v1/swagger.json',
  '/openapi/v1.json',
];

const IGNORED_SEGMENTS = new Set(['api', 'apis', 'rest', 'v1', 'v2', 'v3', 'v4', 'public', 'internal']);

function segmentsOf(p) {
  return String(p)
    .split('?')[0]
    .split('/')
    .filter(Boolean);
}

function resourceOf(p) {
  const segs = segmentsOf(p).filter((s) => !IGNORED_SEGMENTS.has(s.toLowerCase()));
  const named = segs.find((s) => !s.startsWith('{') && !s.startsWith(':'));
  return (named || 'root').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function hasParam(p) {
  return segmentsOf(p).some((s) => s.startsWith('{') || s.startsWith(':'));
}

const ACTION_BY_METHOD = {
  get: (p) => (hasParam(p) ? 'get' : 'list'),
  post: () => 'create',
  put: () => 'update',
  patch: () => 'update',
  delete: () => 'delete',
};

// 末段是名字而不是参数时（POST /menu/{id}/image），用它当动作名。
// 否则 /menu/{id}/image 会被叫成 menu.create，跟「新建菜单」撞在一起。
function actionFromTail(p) {
  const segs = segmentsOf(p).filter((x) => !IGNORED_SEGMENTS.has(x.toLowerCase()));
  if (segs.length < 2) return null;
  const tail = segs[segs.length - 1];
  if (tail.startsWith('{') || tail.startsWith(':')) return null;
  if (tail.toLowerCase() === segs[0].toLowerCase()) return null;
  return tail.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export function toCapabilityId(method, p) {
  const m = String(method).toLowerCase();
  const tail = actionFromTail(p);
  if (tail) return resourceOf(p) + '.' + tail;
  const action = (ACTION_BY_METHOD[m] || (() => m))(p);
  return resourceOf(p) + '.' + action;
}

export function capabilityKind(method) {
  return String(method).toLowerCase() === 'get' ? 'read' : 'write';
}

// OpenAPI 文档 → 能力清单。只认 paths，不猜 schema 语义。
export function parseOpenApi(doc, baseUrl = '') {
  const paths = doc && doc.paths && typeof doc.paths === 'object' ? doc.paths : {};
  const capabilities = [];
  const seen = new Set();
  const servers = Array.isArray(doc?.servers) ? doc.servers.map((s) => s?.url).filter(Boolean) : [];
  for (const [p, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue;
    for (const [method, op] of Object.entries(ops)) {
      if (!ACTION_BY_METHOD[method] && method !== 'head' && method !== 'options') continue;
      const id = toCapabilityId(method, p);
      if (seen.has(id)) continue;
      seen.add(id);
      capabilities.push({
        id,
        kind: capabilityKind(method),
        http: `${method.toUpperCase()} ${p}`,
        path: p,
        method: method.toUpperCase(),
        summary: typeof op?.summary === 'string' ? op.summary.trim() : '',
      });
    }
  }
  capabilities.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    source: 'openapi',
    baseUrl: baseUrl || servers[0] || '',
    title: typeof doc?.info?.title === 'string' ? doc.info.title : '',
    version: typeof doc?.info?.version === 'string' ? doc.info.version : '',
    capabilities,
  };
}

async function fetchJson(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, type: res.headers.get('content-type') || '', text, json };
  } finally {
    clearTimeout(timer);
  }
}

// 探一个站点：能不能连、根路径是什么、有没有机器可读的接口描述。
export async function probeSite(baseUrl, { timeoutMs = 8000 } = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const report = { baseUrl: base, reachable: false, root: null, openapi: null, failures: [] };

  try {
    const root = await fetchJson(base + '/', timeoutMs);
    report.reachable = true;
    const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(root.text || '');
    report.root = {
      status: root.status,
      type: root.type,
      isJson: root.json !== null,
      title: titleMatch ? titleMatch[1].trim() : '',
      bytes: (root.text || '').length,
    };
  } catch (e) {
    report.failures.push({ where: 'GET /', error: String(e && e.message ? e.message : e) });
    return report;
  }

  for (const candidate of OPENAPI_CANDIDATES) {
    try {
      const r = await fetchJson(base + candidate, timeoutMs);
      if (r.status !== 200 || !r.json) continue;
      const parsed = parseOpenApi(r.json, base);
      if (parsed.capabilities.length === 0) continue;
      // doc 是原始描述文件：生成写计划要从里面读请求体结构。它不进 report，避免 --json 变成几兆。
      report.openapi = { url: base + candidate, ...parsed, baseUrl: base, doc: r.json };
      break;
    } catch (e) {
      report.failures.push({ where: candidate, error: String(e && e.message ? e.message : e) });
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// 生成：一个能立刻跑的只读适配器
// ---------------------------------------------------------------------------

const ADAPTER_TEMPLATE = [
  '// 这个文件由 agent-web discover 生成，不是手写的。',
  '//',
  '// 它只会 GET。写操作一律返回 unsupported —— 不是漏了，是机器猜不出',
  '// 「这个业务的写操作应该保证什么」。要用它跑写案例，先把这个文件读一遍，',
  '// 把 execute() 里 unsupported 那几个分支换成真实调用。',
  '//',
  '// 生成时间：__GENERATED_AT__',
  '// 站点：__BASE_URL__',
  '',
  'const BASE = __BASE_LITERAL__;',
  '',
  'const READS = __READS__;',
  '',
  'const WRITES = __WRITES__;',
  '',
  'const WRITE_PLAN = __WRITE_PLAN__;',
  '',
  'const CAPABILITIES = __CAPABILITIES__;',
  '',
  '// 写请求：路径里的 {id} 从 arguments 里取，body 优先用案例给的，其次用探测推出来的。',
  'async function sendWrite(plan, action, timeoutMs) {',
  '  const args = (action && action.arguments) || {};',
  '  let p = plan.path;',
  '  for (const [k, v] of Object.entries(args)) {',
  '    if (v !== null && typeof v === "object") continue;',
  '    p = p.split("{" + k + "}").join(encodeURIComponent(String(v)));',
  '  }',
  '  if (/\{[A-Za-z0-9_]+\}/.test(p)) {',
  '    return { outcome: "unsupported", error: { code: "missing_path_param", message: "路径里还有没填的参数：" + p } };',
  '  }',
  '  const body = args.body !== undefined ? args.body : plan.body;',
  '  const ac = new AbortController();',
  '  const timer = setTimeout(() => ac.abort(), timeoutMs);',
  '  try {',
  '    const res = await fetch(BASE + p, {',
  '      method: plan.method,',
  '      signal: ac.signal,',
  '      headers: { accept: "application/json", "content-type": "application/json" },',
  '      body: body === undefined ? undefined : JSON.stringify(body),',
  '    });',
  '    const text = await res.text();',
  '    let json = null;',
  '    try { json = JSON.parse(text); } catch { json = null; }',
  '    if (res.status >= 500) return { outcome: "infra_error", error: { code: "http_" + res.status } };',
  '    if (res.status >= 400) return { outcome: "rejected", error: { code: "http_" + res.status, message: text.slice(0, 200) } };',
  '    return { outcome: "applied", payload: json };',
  '  } catch (e) {',
  '    return { outcome: "infra_error", error: { code: "network", message: String(e && e.message ? e.message : e) } };',
  '  } finally {',
  '    clearTimeout(timer);',
  '  }',
  '}',
  '',
  'async function getJson(p, timeoutMs) {',
  '  const ac = new AbortController();',
  '  const timer = setTimeout(() => ac.abort(), timeoutMs);',
  '  try {',
  '    const res = await fetch(BASE + p, {',
  '      signal: ac.signal,',
  '      headers: { accept: "application/json" },',
  '    });',
  '    const text = await res.text();',
  '    let json = null;',
  '    try { json = JSON.parse(text); } catch { json = null; }',
  '    return { status: res.status, json, bytes: text.length };',
  '  } finally {',
  '    clearTimeout(timer);',
  '  }',
  '}',
  '',
  'export function createAdapter(options = {}) {',
  '  const timeoutMs = options.timeoutMs || 8000;',
  '  let seq = 0;',
  '  return {',
  '    async manifest() {',
  '      return {',
  '        adapter: __NAME_LITERAL__,',
  '        adapter_version: "agent-web/discover-1",',
  '        reset_strategy: "identity",',
  '        description: __DESC_LITERAL__,',
  '        scopes: __SCOPES__,',
  '        events_complete: false,',
  '        roles: ["viewer"],',
  '        capabilities: CAPABILITIES,',
  '      };',
  '    },',
  '',
  '    // 只读适配器没有可复位的东西：它不写，也就不需要隔离。',
  '    // 换成有写操作的版本时，这里要按你的应用重新实现（新账号 / 重建库 / 换快照）。',
  '    async reset() {',
  '      seq += 1;',
  '      return { runId: "discover-" + seq, roleBindings: { viewer: null } };',
  '    },',
  '',
  '    async observe(runId, scopes) {',
  '      const wanted = Array.isArray(scopes) && scopes.length > 0 ? scopes : Object.keys(READS);',
  '      const state = {};',
  '      const missingScopes = [];',
  '      for (const name of wanted) {',
  '        const cap = READS[name];',
  '        if (!cap) { missingScopes.push(name); continue; }',
  '        try {',
  '          const r = await getJson(cap.path, timeoutMs);',
  '          if (r.status !== 200 || !r.json) { missingScopes.push(name); continue; }',
  '          state[name] = Array.isArray(r.json) ? r.json : [r.json];',
  '        } catch {',
  '          missingScopes.push(name);',
  '        }',
  '      }',
  '      return { state, missingScopes };',
  '    },',
  '',
  '    async execute(runId, action) {',
  '      const read = READS_BY_ID[action.capability];',
  '      if (read) {',
  '        try {',
  '          const r = await getJson(read.path, timeoutMs);',
  '          if (r.status >= 500) return { outcome: "infra_error", error: { code: "http_" + r.status } };',
  '          if (r.status >= 400) return { outcome: "rejected", error: { code: "http_" + r.status } };',
  '          return { outcome: "applied", payload: r.json };',
  '        } catch (e) {',
  '          return { outcome: "infra_error", error: { code: "network", message: String(e && e.message ? e.message : e) } };',
  '        }',
  '      }',
  '      if (WRITES_BY_ID[action.capability]) {',
  '        const plan = WRITE_PLAN[action.capability];',
  '        if (plan) return sendWrite(plan, action, timeoutMs);',
  '        return {',
  '          outcome: "unsupported",',
  '          error: { code: "write_not_implemented", message: "生成只给了读；写要你照着这个文件的形状自己接" },',
  '        };',
  '      }',
  '      return { outcome: "unsupported", error: { code: "unknown_capability" } };',
  '    },',
  '',
  '    async close() {},',
  '  };',
  '}',
  '',
  'const READS_BY_ID = Object.fromEntries(',
  '  CAPABILITIES.filter((c) => c.kind === "read").map((c) => [c.id, READS[c.resource]]),',
  ');',
  'const WRITES_BY_ID = Object.fromEntries(',
  '  CAPABILITIES.filter((c) => c.kind === "write").map((c) => [c.id, true]),',
  ');',
  '',
].join('\n');

function jsonLiteral(value) {
  return JSON.stringify(value, null, 2).split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
}

// ---------------------------------------------------------------------------
// 写操作：能机械推的只有「往返语义」，推不出来的是业务规则
// ---------------------------------------------------------------------------

const MAX_SYNTH_DEPTH = 4;

/**
 * 从 JSON Schema 造一份"形状对"的请求体。
 *
 * 它造不出正确的业务数据 —— 名字叫什么都行，数量是不是 1 都行。它只保证一件事：
 * 服务器不会因为我们送错类型而拒收。所以生成出来的写案例断言的是
 * 「写之后列表多了一条」，不是「写之后内容正确」。
 */
export function synthesizeBody(schema, depth = 0, components = {}) {
  if (!schema || typeof schema !== 'object' || depth > MAX_SYNTH_DEPTH) return null;
  if (schema.$ref) {
    const ref = String(schema.$ref);
    const name = ref.split('/').pop();
    const target = components[name];
    if (!target) return null;
    return synthesizeBody(target, depth + 1, components);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  const type = schema.type || (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const out = {};
      const props = schema.properties || {};
      for (const [key, sub] of Object.entries(props)) {
        const v = synthesizeBody(sub, depth + 1, components);
        if (v !== null) out[key] = v;
      }
      return out;
    }
    case 'array': {
      const item = synthesizeBody(schema.items, depth + 1, components);
      return item === null ? [] : [item];
    }
    case 'integer':
    case 'number':
      return schema.minimum !== undefined ? schema.minimum : 1;
    case 'boolean':
      return true;
    case 'string':
      return schema.minLength && schema.minLength > 1 ? 'x'.repeat(schema.minLength) : 'x';
    default:
      return null;
  }
}

/** 把探测到的写接口分成 create / update / delete，并带上要送出去的 body。 */
export function writePlanOf(capabilities, openapiDoc = null) {
  const components = (openapiDoc && openapiDoc.components && openapiDoc.components.schemas) || {};
  const paths = (openapiDoc && openapiDoc.paths) || {};
  const plan = {};
  for (const c of capabilities) {
    if (c.kind !== 'write') continue;
    const hasPathParam = c.path.includes('{') || c.path.includes(':');
    const kind = !hasPathParam && c.method === 'POST'
      ? 'create'
      : c.method === 'DELETE'
        ? 'delete'
        : c.method === 'PUT' || c.method === 'PATCH'
          ? 'update'
          : null;
    if (!kind) continue;
    // 只有 create 能在「什么都没准备」的情况下跑起来：delete / update 都要先有一条真的实体。
    // 探测阶段拿不到实体 id，硬编一个去打就是我方造出来的 404。所以只对 create 出计划。
    if (kind !== 'create') continue;
    const op = paths[c.path] && paths[c.path][String(c.method).toLowerCase()];
    let body = null;
    if (op && op.requestBody && op.requestBody.content) {
      const content = op.requestBody.content;
      const schema = (content['application/json'] && content['application/json'].schema) || null;
      body = synthesizeBody(schema, 0, components);
    }
    plan[c.id] = { path: c.path, method: c.method, body };
  }
  return plan;
}

/** 写案例：只断「往返」—— 写完之后那个集合确实多了一条。 */
export function buildWriteCases({ adapterName, baseUrl, capabilities, writePlan = {}, confirmedBy = null, now = new Date() }) {
  const docs = [];
  for (const [id, plan] of Object.entries(writePlan)) {
    const resource = resourceOf(plan.path);
    const doc = {
      schema_version: 'agent-web/0.1',
      id: `discovered/${resource}-create`,
      environment: { adapter: adapterName, seed: 1, clock_policy: 'frozen' },
      task: {
        natural_goal: `创建一条 ${resource}，检查列表是不是真的多了一条（由 ${baseUrl} 推断生成）`,
        allowed_capabilities: [id],
        goal_assertions: [
          { kind: 'count_delta', selector: { collection: resource }, delta: 1 },
        ],
        invariants: [],
      },
      observability: { declared_scopes: [resource] },
      reference_trajectory: [
        {
          id: 's1',
          capability: id,
          as: 'viewer',
          arguments: plan.body === null ? {} : { body: plan.body },
          expected_outcome: 'applied',
        },
      ],
    };
    doc.draft = confirmedBy
      ? { status: 'confirmed', reviewed_by: confirmedBy, reviewed_at: now.toISOString() }
      : { status: 'unconfirmed', source: 'agent-web discover --writes', generated_at: now.toISOString() };
    docs.push(doc);
  }
  return docs;
}

export function pickReadEndpoints(capabilities) {
  // 每个资源挑一个不带参数的 GET 当读入口。它决定 observe() 能看见什么。
  const reads = {};
  for (const c of capabilities) {
    if (c.kind !== 'read') continue;
    if (c.method !== 'GET') continue;
    if (c.path.includes('{') || c.path.includes(':')) continue;
    const resource = resourceOf(c.path);
    if (!reads[resource]) reads[resource] = { path: c.path, capability: c.id };
  }
  return reads;
}

export function buildAdapterSource({ adapterName, baseUrl, capabilities, generatedAt, writePlan = {} }) {
  const reads = pickReadEndpoints(capabilities);
  const writes = capabilities.filter((c) => c.kind === 'write');
  const scopes = Object.keys(reads);
  const capList = capabilities.map((c) => ({
    id: c.id,
    kind: c.kind,
    evidence_level: 'inferred',
    roles: ['viewer'],
    http: c.http,
    resource: resourceOf(c.path),
  }));
  return ADAPTER_TEMPLATE
    .replace('__GENERATED_AT__', generatedAt)
    .replace('__BASE_URL__', baseUrl)
    .replace('__BASE_LITERAL__', JSON.stringify(baseUrl))
    .replace('__NAME_LITERAL__', JSON.stringify(adapterName))
    .replace('__DESC_LITERAL__', JSON.stringify(`由 ${baseUrl} 自动探测生成（只读，${capabilities.length} 个接口）`))
    .replace('__SCOPES__', jsonLiteral(scopes))
    .replace('__READS__', jsonLiteral(reads))
    .replace('__WRITES__', jsonLiteral(writes.map((w) => w.id)))
    .replace('__WRITE_PLAN__', jsonLiteral(writePlan))
    .replace('__CAPABILITIES__', jsonLiteral(capList));
}

export function buildCaseDocs({ adapterName, baseUrl, capabilities, confirmedBy = null, now = new Date() }) {
  const reads = pickReadEndpoints(capabilities);
  const docs = [];
  for (const [resource, read] of Object.entries(reads)) {
    const doc = {
      schema_version: 'agent-web/0.1',
      id: `discovered/${resource}-readonly`,
      environment: { adapter: adapterName, seed: 1, clock_policy: 'frozen' },
      task: {
        natural_goal: `读一次 ${resource}，不该改变任何东西（由 ${baseUrl} 探测生成）`,
        allowed_capabilities: [read.capability],
        goal_assertions: [{ kind: 'unchanged', scopes: [resource] }],
        invariants: [],
      },
      observability: { declared_scopes: [resource] },
      reference_trajectory: [
        { id: 's1', capability: read.capability, as: 'viewer', expected_outcome: 'applied' },
      ],
    };
    doc.draft = confirmedBy
      ? { status: 'confirmed', reviewed_by: confirmedBy, reviewed_at: now.toISOString() }
      : { status: 'unconfirmed', source: 'agent-web discover', generated_at: now.toISOString() };
    docs.push(doc);
  }
  return docs;
}

// ---------------------------------------------------------------------------
// 实跑：把探测到的只读接口真的打一遍
// ---------------------------------------------------------------------------

export async function runReads(baseUrl, capabilities, { timeoutMs = 8000 } = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');
  const results = [];
  for (const c of capabilities) {
    if (c.kind !== 'read') continue;
    if (c.method !== 'GET') continue;
    if (c.path.includes('{') || c.path.includes(':')) {
      // 路径里有 {id} 这种占位符，探测阶段拿不到真实 id。
      // 硬拼一个 /orders/{id} 去打，服务器会回 404 —— 那是我们造的假失败，不是站点的问题。
      results.push({ id: c.id, http: c.http, status: 0, ok: true, json: false, rows: null, bytes: 0, ms: 0, skipped: '需要路径参数' });
      continue;
    }
    const url = base + c.path;
    const started = Date.now();
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
      const text = await res.text();
      clearTimeout(timer);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      results.push({
        id: c.id,
        http: c.http,
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        json: json !== null,
        rows: Array.isArray(json) ? json.length : json === null ? null : 1,
        bytes: text.length,
        ms: Date.now() - started,
      });
    } catch (e) {
      results.push({
        id: c.id,
        http: c.http,
        status: 0,
        ok: false,
        json: false,
        rows: null,
        bytes: 0,
        ms: Date.now() - started,
        error: String(e && e.message ? e.message : e),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export async function discover(baseUrl, opts = {}) {
  const { outDir = './agent-web-site', run = false, accept = null, timeoutMs = 8000, writes = false } = opts;
  const startedAt = new Date();
  const probe = await probeSite(baseUrl, { timeoutMs });

  const report = {
    version: DISCOVER_VERSION,
    baseUrl: probe.baseUrl,
    reachable: probe.reachable,
    root: probe.root,
    failures: probe.failures,
    source: probe.openapi ? 'openapi' : 'none',
    openapi: probe.openapi
      ? { url: probe.openapi.url, title: probe.openapi.title, version: probe.openapi.version }
      : null,
    capabilities: probe.openapi ? probe.openapi.capabilities : [],
    reads: [],
    written: [],
    outDir,
    generatedAt: startedAt.toISOString(),
    limits: [],
  };

  if (!probe.openapi) {
    report.limits.push('没有发现机器可读的接口描述（OpenAPI），因此没有生成适配器');
    report.limits.push('两条可走的路：把接口描述放到站点上，或者用 record / prepare 从真实流量里还原案例');
    return report;
  }

  const adapterName = path.basename(path.resolve(outDir)) || 'discovered';
  const caps = probe.openapi.capabilities;
  const writePlan = writes ? writePlanOf(caps, probe.openapi.doc) : {};
  const reads = pickReadEndpoints(caps);
  report.readEndpoints = reads;

  mkdirSync(outDir, { recursive: true });
  const adapterPath = path.join(outDir, 'adapter.mjs');
  writeFileSync(
    adapterPath,
    buildAdapterSource({ adapterName, baseUrl: probe.baseUrl, capabilities: caps, generatedAt: report.generatedAt, writePlan }),
    'utf8',
  );
  report.written.push(adapterPath);

  const casesDir = path.join(outDir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  for (const doc of buildCaseDocs({ adapterName, baseUrl: probe.baseUrl, capabilities: caps, confirmedBy: accept, now: startedAt })) {
    const file = path.join(casesDir, `${doc.id.split('/')[1]}.json`);
    writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    report.written.push(file);
  }

  for (const doc of buildWriteCases({ adapterName, baseUrl: probe.baseUrl, capabilities: caps, writePlan, confirmedBy: accept, now: startedAt })) {
    const file = path.join(casesDir, `${doc.id.split('/')[1]}.json`);
    writeFileSync(file, JSON.stringify(doc, null, 2) + String.fromCharCode(10), 'utf8');
    report.written.push(file);
  }
  report.writePlan = Object.keys(writePlan);
  report.writeTodo = caps
    .filter((c) => c.kind === 'write' && !writePlan[c.id])
    .map((c) => ({ id: c.id, http: c.http, why: c.path.includes('{') ? '需要先有一条真实实体（delete / update）' : '不是 create，语义要人给' }));

  if (run) report.reads = await runReads(probe.baseUrl, caps, { timeoutMs });

  if (Object.keys(writePlan).length > 0) {
    report.limits.push('写案例只断「往返」：写完之后那个集合多了一条。它不断言写进去的内容对不对 —— 那需要业务知识');
    report.limits.push('delete / update 没有生成：探测阶段拿不到真实实体 id，硬编一个去打就是自己造的 404');
  } else {
    report.limits.push('写操作全部没有实现：execute() 对它们是 unsupported，因为「该保证什么」需要业务知识');
  }
  report.limits.push('没有登录流程：如果接口需要鉴权，生成的文件会在 observe 里把它们记成 missingScopes');
  report.limits.push('字段语义没猜：案例只断言「读不改变状态」，没有断言任何业务含义');
  if (!accept) report.limits.push('生成的案例是草稿，判决前要先人工确认（agent-web accept <文件> --by=<你的名字>）');

  return report;
}

export function formatDiscover(report, { detail = false } = {}) {
  const out = [];
  const push = (s = '') => out.push(s);

  push('探测 ' + report.baseUrl);
  push('');
  if (!report.reachable) {
    push('  连不上。' + (report.failures[0] ? report.failures[0].error : ''));
    push('  检查：服务起了没有、地址有没有写错端口、有没有挡在前面的网关。');
    return out.join('\n');
  }

  const root = report.root || {};
  push('  根路径  ' + root.status + '  ' + (root.type || '未知类型') + '  ' + root.bytes + ' 字节' + (root.title ? '  ' + root.title : ''));
  push(
    '  接口描述  ' +
      (report.source === 'openapi'
        ? report.openapi.url + (report.openapi.title ? '  ' + report.openapi.title + ' ' + report.openapi.version : '')
        : '没找到（试过 ' + OPENAPI_CANDIDATES.length + ' 个常见位置）'),
  );
  if (root.status !== 200) {
    push('  根路径不是 200，但站点是通的 —— 很多后端只提供接口、根路径本来就什么都不返回。');
  }
  push('');

  if (report.source !== 'openapi') {
    push('没有机器可读的接口描述，生成不了适配器。');
    push('');
    push('这不是失败。它说明这台站点没打算被程序读懂，那就只能从真实流量里还原：');
    push('  1. 用浏览器把要测的流程操作一遍，抓包');
    push('  2. 把请求导成一行一个的 JSONL 动作日志（record / prepare 吃的是这份日志，不是 HAR 原文件）');
    push('  3. node bin/agent-web.mjs prepare <日志.jsonl> --adapter=<你写的一半适配器> --out-dir=./my-site');
    push('  4. 照着生成的骨架补 observe()，再 accept + verify');
    return out.join('\n');
  }

  const reads = report.capabilities.filter((c) => c.kind === 'read');
  const writes = report.capabilities.filter((c) => c.kind === 'write');
  push('  探测到 ' + report.capabilities.length + ' 个接口：只读 ' + reads.length + '，写 ' + writes.length);
  const show = detail ? report.capabilities : report.capabilities.slice(0, 12);
  for (const c of show) {
    push('    ' + (c.kind === 'read' ? 'R' : 'W') + '  ' + c.id.padEnd(24) + c.http);
  }
  if (!detail && report.capabilities.length > show.length) {
    push('    …另有 ' + (report.capabilities.length - show.length) + ' 个，加 --detail 看全');
  }
  push('');

  if (report.reads.length > 0) {
    push('  实跑 ' + report.reads.length + ' 个只读接口：');
    for (const r of report.reads) {
      if (r.skipped) {
        push('    SKIP  ' + r.skipped.padEnd(10) + r.id + '  ' + r.http);
        continue;
      }
      const mark = r.ok ? 'OK  ' : 'FAIL';
      push(
        '    ' + mark + '  ' + String(r.status).padEnd(4) + String(r.ms + 'ms').padEnd(7) +
          (r.rows === null ? '-' : r.rows + ' 行').padEnd(8) + r.id + (r.error ? '  ' + r.error : ''),
      );
    }
    const ran = report.reads.filter((r) => !r.skipped);
    const okCount = ran.filter((r) => r.ok).length;
    push('    ' + okCount + '/' + ran.length + ' 可用' + (report.reads.length > ran.length ? '，' + (report.reads.length - ran.length) + ' 个需要参数没打' : ''));
    push('');
  }

  if (Array.isArray(report.writePlan) && report.writePlan.length > 0) {
    push('  写案例（只断往返）：');
    for (const id of report.writePlan) push('    ' + id);
    if (Array.isArray(report.writeTodo) && report.writeTodo.length > 0) {
      push('  这些写接口没生成案例：');
      for (const t of report.writeTodo) push('    ' + String(t.id).padEnd(24) + String(t.http).padEnd(34) + t.why);
    }
    push('');
  }

  if (report.written.length > 0) {
    push('  生成：');
    for (const f of report.written) push('    ' + f);
    push('');
    push('  下一步：');
    push('    node bin/agent-web.mjs probe --adapter=' + report.outDir + '/adapter.mjs');
    push('    node bin/agent-web.mjs accept ' + report.outDir + '/cases/<某个>.json --by=<你的名字>');
    push('    node bin/agent-web.mjs verify ' + report.outDir + '/cases --adapter=' + report.outDir + '/adapter.mjs');
    push('');
  }

  push('  这次没能给的东西：');
  for (const l of report.limits) push('    - ' + l);

  return out.join('\n');
}

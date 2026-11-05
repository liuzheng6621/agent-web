/**
 * 声明式适配器解释器：把一份 adapter.yml（数据）变成五方法契约（代码行为）。
 *
 * 为什么值得存在：接一个新域的半天里，约六成五是「把他们 JSON 投影成规范视图」
 * 和「把他们的错误码翻译成四种 outcome」——这两件事都是表，不是逻辑。
 * 是表就能由机器预填、由人改错行，而不是由人从零写投影函数。
 *
 * 红线不变：
 *   - 规格是数据，解释器不 eval 任何字符串（与 .mjs 适配器「加载即执行代码」不同，
 *     decl 路径没有代码执行面，load 里对 .yml/.json 不走 import）。
 *   - base_url 只许来自环境变量，或显式的 loopback 字面值（与动物救助域同一规矩）。
 *   - 认不出的错误码不猜：落 errors.default，没有 default 就按状态码段，再没有就 infra_error。
 */

import { validateManifest } from './contract.mjs';
import { parseYaml } from '../yaml.mjs';
import fs from 'node:fs';

export const DECL_VERSION = 'agent-web/decl-1';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/;

export class DeclError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeclError';
  }
}

/** 读一份规格：.json 走 JSON，其余走 YAML 子集。 */
export function loadDeclSpec(file) {
  const text = fs.readFileSync(file, 'utf8');
  const spec = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
  if (!spec || typeof spec !== 'object') throw new DeclError(`${file} 解析出来不是对象`);
  return spec;
}

function baseUrlOf(spec) {
  const bu = spec.base_url;
  if (!bu || typeof bu !== 'object') throw new DeclError('base_url 必填，形如 { env: NAME }');
  if (bu.env) {
    const v = process.env[bu.env];
    if (!v) throw new DeclError(`base_url.env 指向的环境变量 ${bu.env} 没有设`);
    return v.replace(/\/$/, '');
  }
  if (bu.value) {
    if (!LOOPBACK.test(bu.value)) {
      throw new DeclError('base_url.value 只许 loopback 字面值；远程目标请走环境变量，别把地址写进文件');
    }
    return bu.value.replace(/\/$/, '');
  }
  throw new DeclError('base_url 需要 env 或 value 之一');
}

/** 编译一个字段选择器：$.a.b / $.a[*].b / $.a[*].{x: src, y: src2} / 包装 {from, type}。 */
export function compileSelector(sel) {
  if (sel !== null && typeof sel === 'object' && !Array.isArray(sel)) {
    const inner = compileSelector(sel.from ?? sel.path);
    const type = sel.type ?? null;
    return (row) => coerce(inner(row), type);
  }
  if (typeof sel !== 'string' || !sel.startsWith('$')) {
    throw new DeclError(`选择器必须以 $ 开头：${String(sel)}`);
  }
  const segs = [];
  let rest = sel.slice(1);
  while (rest !== '') {
    if (rest.startsWith('.')) rest = rest.slice(1);
    if (rest.startsWith('[*]')) {
      segs.push({ each: true });
      rest = rest.slice(3);
      continue;
    }
    const m = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (m) {
      segs.push({ key: m[1] });
      rest = rest.slice(m[1].length);
      continue;
    }
    const proj = rest.match(/^\{([^}]*)\}/);
    if (proj) {
      const map = {};
      for (const part of proj[1].split(',')) {
        if (part.trim() === '') continue;
        const ci = part.indexOf(':');
        if (ci < 0) throw new DeclError(`投影段缺冒号：${part}`);
        map[part.slice(0, ci).trim()] = part.slice(ci + 1).trim();
      }
      segs.push({ project: map });
      rest = rest.slice(proj[0].length);
      continue;
    }
    throw new DeclError(`选择器读不懂的一段：${rest}`);
  }
  return (root) => walk(root, segs, 0);
}

function walk(value, segs, i) {
  if (i >= segs.length) return value;
  const seg = segs[i];
  if (seg.each) {
    if (!Array.isArray(value)) return undefined;
    return value.map((v) => walk(v, segs, i + 1));
  }
  if (seg.project) {
    if (value === undefined || value === null) return undefined;
    const out = {};
    for (const [k, src] of Object.entries(seg.project)) out[k] = walk(value, [{ key: src }, ...segs.slice(i + 1)], 0);
    return out;
  }
  if (value === undefined || value === null) return undefined;
  return walk(value[seg.key], segs, i + 1);
}

function coerce(v, type) {
  if (v === undefined || v === null || !type) return v === undefined ? null : v;
  switch (type) {
    case 'integer':
      return Number.isFinite(Number(v)) ? Math.round(Number(v)) : null;
    case 'number':
      return Number.isFinite(Number(v)) ? Number(v) : null;
    case 'string':
      return String(v);
    case 'boolean':
      return Boolean(v);
    default:
      throw new DeclError(`不认识的 type：${type}`);
  }
}

function methodOf(cap) {
  for (const m of METHODS) if (cap[m]) return m;
  return null;
}

/** 错误码表查 outcome：body.code → 状态码 → 状态段 → default → 状态段兜底。 */
export function classifyStatus(status, bodyCode, errors) {
  const table = errors || {};
  const byCode = bodyCode !== undefined && bodyCode !== null ? table[String(bodyCode)] : undefined;
  if (byCode) return byCode;
  if (table[String(status)]) return table[String(status)];
  const band = `${Math.floor(status / 100)}xx`;
  if (table[band]) return table[band];
  if (table.default) return table.default;
  if (status >= 200 && status < 300) return 'applied';
  if (status >= 400 && status < 500) return 'rejected';
  return 'infra_error';
}

export function createAdapterFromSpec(spec, options = {}) {
  const baseUrl = baseUrlOf(spec);
  const auth = spec.auth || null;
  const roles = Array.isArray(spec.roles) && spec.roles.length ? spec.roles : ['anonymous'];
  const caps = spec.capabilities || {};
  const view = spec.view || {};
  const errors = spec.errors || {};
  const viewGetters = {};
  for (const [name, def] of Object.entries(view)) {
    if (!def || typeof def.from !== 'string') throw new DeclError(`view.${name} 缺 from`);
    const fields = {};
    for (const [k, sel] of Object.entries(def.fields || {})) fields[k] = compileSelector(sel);
    viewGetters[name] = { from: def.from, fields };
  }
  const sessions = new Map();
  let runCounter = 0;

  async function login(role) {
    if (!auth) return null;
    const account = (auth.accounts || {})[role];
    if (!account) return null;
    const [method, path] = String(auth.login).split(' ');
    const body = {};
    body[auth.user_field || 'username'] = account.user;
    body[auth.pass_field || 'password'] = account.pass_env ? process.env[account.pass_env] || '' : account.pass || '';
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new DeclError(`角色 ${role} 登录失败：HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    const tokenSel = compileSelector(auth.token || '$.token');
    const token = tokenSel(json);
    if (!token) throw new DeclError(`角色 ${role} 登录后按 ${auth.token} 取不到 token`);
    return { token };
  }

  async function sessionFor(role) {
    if (!auth) return null;
    if (!sessions.has(role)) sessions.set(role, await login(role));
    return sessions.get(role);
  }

  function headersFor(role) {
    const h = { 'Content-Type': 'application/json' };
    const s = sessions.get(role);
    if (s && s.token) h[auth && auth.header ? auth.header : 'Authorization'] = `${(auth && auth.prefix) || 'Bearer '}${s.token}`;
    return h;
  }

  async function send(method, pathTemplate, args, role, bodyMode) {
    let path = pathTemplate;
    const used = new Set();
    path = path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => {
      const v = (args || {})[k];
      if (v === undefined) throw Object.assign(new Error(`路径参数 ${k} 没有给`), { declMissingArg: k });
      used.add(k);
      return encodeURIComponent(String(v));
    });
    const init = { method, headers: headersFor(role) };
    if (bodyMode === 'args') {
      const rest = {};
      for (const [k, v] of Object.entries(args || {})) if (!used.has(k)) rest[k] = v;
      init.body = JSON.stringify(rest);
    } else if (bodyMode && typeof bodyMode === 'object') {
      init.body = JSON.stringify(bodyMode);
    }
    const res = await fetch(baseUrl + path, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { res, json };
  }

  async function manifest() {
    const capabilities = Object.entries(caps).map(([id, cap]) => {
      const m = cap.unsupported ? 'write' : methodOf(cap) === 'GET' ? 'read' : 'write';
      return {
        id,
        kind: m,
        evidence_level: spec.evidence || 'inferred',
        roles: cap.as || roles,
        args: cap.args || {},
      };
    });
    const m = {
      adapter: spec.adapter || 'decl',
      adapter_version: String(spec.version || '1.0.0'),
      reset_strategy: (spec.reset && spec.reset.strategy) || 'reseed',
      description: spec.description || '声明式适配器（由 adapter.yml 解释执行）',
      scopes: Object.keys(view),
      roles,
      events_complete: false,
      canonical_view: 'agent-web/canonical-view',
      view: {
        version: 'agent-web/view/1',
        collections: Object.fromEntries(
          Object.entries(view).map(([name, def]) => [
            name,
            { kind: 'list', required: Object.keys(def.fields || {}), semantics: def.semantics || name },
          ]),
        ),
      },
      capabilities,
      decl: { version: DECL_VERSION, source: spec.source || 'hand' },
    };
    const errs = validateManifest(m);
    if (errs.length) throw new DeclError(`规格生成的 manifest 不合法：${errs.join('；')}`);
    return m;
  }

  async function reset() {
    sessions.clear();
    runCounter += 1;
    const calls = (spec.reset && spec.reset.calls) || [];
    for (const call of calls) {
      const c = typeof call === 'string' ? { method: call.split(' ')[0], path: call.split(' ')[1] } : call;
      const role = c.as || null;
      if (role) await sessionFor(role);
      const { res } = await send(c.method, c.path, c.args || {}, role, c.body || null);
      if (res.status >= 500) throw new DeclError(`reset 调用 ${c.method} ${c.path} 返回 ${res.status}`);
    }
    for (const role of roles) {
      if ((auth && (auth.accounts || {})[role]) || !auth) await sessionFor(role).catch(() => null);
    }
    const obs = await observeInternal(Object.keys(view));
    return { runId: `decl-${runCounter}`, state: obs.state };
  }

  async function observeInternal(scopes) {
    const state = {};
    const missing = [];
    for (const name of scopes) {
      const getter = viewGetters[name];
      if (!getter) {
        missing.push(name);
        continue;
      }
      const [method, path] = getter.from.split(' ');
      try {
        const { res, json } = await send(method || 'GET', path, {}, observeRole(), null);
        if (!res.ok) {
          missing.push(name);
          continue;
        }
        // 找响应里包裹数组的键：先试常用名，再自检测
        let wrapperKey = null;
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          for (const wk of ['items', 'data', 'results', 'list']) {
            if (Array.isArray(json[wk])) { wrapperKey = wk; break; }
          }
          if (!wrapperKey) {
            const arrKeys = Object.entries(json).filter(function(e) { return Array.isArray(e[1]); });
            wrapperKey = arrKeys.length === 1 ? arrKeys[0][0] : null;
          }
        }
        const rows = wrapperKey ? json[wrapperKey] : Array.isArray(json) ? json : [];
        state[name] = rows.map((row) => {
          const out = {};
          for (const [k, fn] of Object.entries(getter.fields)) out[k] = fn(row);
          return out;
        });
      } catch {
        missing.push(name);
      }
    }
    if (missing.length === scopes.length && scopes.length > 0) return { state: null, missingScopes: missing };
    return { state, missingScopes: missing };
  }

  function observeRole() {
    return roles[0];
  }

  function listKeyOf(path) {
    const seg = path.split('/').filter(Boolean).pop() || '';
    return seg;
  }

  async function observe(runId, scopes) {
    return observeInternal(scopes && scopes.length ? scopes : Object.keys(view));
  }

  async function execute(runId, action) {
    const cap = caps[action.capability];
    if (!cap) return { outcome: 'unsupported', error: { code: 'unknown_capability', message: action.capability } };
    if (cap.unsupported) return { outcome: 'unsupported', error: { code: 'decl_unsupported', message: '规格里标了 unsupported' } };
    if (!roles.includes(action.as)) return { outcome: 'rejected', error: { code: 'unknown_role', message: `角色 ${action.as} 不在 roles 里` } };
    const method = methodOf(cap);
    if (!method) return { outcome: 'unsupported', error: { code: 'decl_no_method', message: action.capability } };
    await sessionFor(action.as).catch(() => null);
    try {
      const bodyMode = cap.body === undefined ? (method === 'GET' ? null : 'args') : cap.body === 'from_args' ? 'args' : cap.body;
      let path = cap[method];      if (cap.query && cap.query.length) {
        const qs = cap.query
          .filter((k) => (action.arguments || {})[k] !== undefined)
          .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(action.arguments[k]))}`)
          .join('&');
        if (qs) path += (path.includes('?') ? '&' : '?') + qs;
      }
      const { res, json } = await send(method, path, action.arguments || {}, action.as, bodyMode);
      const code = json && (json.code ?? json.errorCode ?? json.errno);
      const outcome = classifyStatus(res.status, code, errors);
      if (outcome === 'applied') return { outcome, payload: json };
      return {
        outcome: OUTCOME_GUARD(outcome),
        payload: json,
        error: { code: String(code ?? res.status), message: (json && (json.message || json.error)) || '' },
      };
    } catch (e) {
      if (e && e.declMissingArg) {
        return { outcome: 'unsupported', error: { code: 'missing_argument', message: e.declMissingArg } };
      }
      return { outcome: 'infra_error', error: { code: 'decl_fetch', message: String(e && e.message) } };
    }
  }

  function OUTCOME_GUARD(o) {
    return ['applied', 'rejected', 'unsupported', 'infra_error'].includes(o) ? o : 'infra_error';
  }

  async function close() {
    sessions.clear();
  }

  return { manifest, reset, observe, execute, close };
}

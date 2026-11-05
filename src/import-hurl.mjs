// 把 hurl 套件转成 agent-web 的案例。
//
// 为什么是 hurl 而不是 Postman/Bruno：它是纯文本、有 [Captures] 与 [Asserts] 段、
// 断言词汇小（== / isString / isList / not isEmpty / count >= n / contains），
// 正好对上我们已有的 `payload` 断言；而且 RealWorld 这类语料自带一整套 hurl。
//
// 转换器的立场：**能确定的照搬，不能确定的留成待办**。它不是「猜」的机器。

import fs from 'node:fs';
import path from 'node:path';

export const HURL_VERSION = 'agent-web/hurl-1';

// 变量占位符。不能写成 `__name__`：hurl 里 `auth_{{uid}}` 会先变成 `auth___uid__`，
// 而 `/__([A-Za-z0-9_]+)__/` 会从第二个下划线开始匹配、把名字读成 `_uid`，结果 `auth000000`。
// 占位符必须是**JSON 安全**的：`` 控制字符放在 JSON 字符串里会让 JSON.parse 直接抛错，
// 结果整块 body 变成 null，案例跑起来就是「body is missing」。
const MARK = '@@';
const MARK_RE = /@@([A-Za-z0-9_]+)@@/g;

/** 递归替换占位符：数组与对象里的字符串也要换，tagList 这种就靠它。 */
function deepFill(value, uid) {
  if (typeof value === 'string') return value.replace(MARK_RE, uid);
  if (Array.isArray(value)) return value.map((v) => deepFill(v, uid));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepFill(v, uid);
    return out;
  }
  return value;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function expandVars(text, vars) {
  return String(text).replace(VAR_RE, (_, name) => (name in vars ? String(vars[name]) : `${MARK}${name}${MARK}`));
}

/** URL 路径段；RealWorld 的资源根路径能确定静态 slug 所在位置。 */
function routeParts(url) {
  const clean = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  const apiIndex = parts.indexOf('api');
  if (apiIndex >= 0) return parts.slice(apiIndex + 1);
  const versionIndex = parts.findIndex((part) => /^v[1-9]\d*$/.test(part));
  return versionIndex >= 0 ? parts.slice(versionIndex + 1) : parts;
}

function routeParam(segment) {
  const value = String(segment);
  const variable = value.match(/^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/);
  if (variable) return variable[1];
  return value;
}

/** 从 URL 里剥出资源名与参数。RealWorld 的静态 slug 也按路由位置识别为参数。 */
export function splitUrl(url) {
  const route = routeParts(url);
  if (route[0] === 'articles') {
    if (route[1] === 'feed' || route.length === 1) return { resource: 'articles', params: [] };
    const slug = routeParam(route[1]);
    if (route[2] === 'comments') {
      const params = [slug];
      if (route[3] !== undefined) params.push(routeParam(route[3]));
      return { resource: 'comments', params };
    }
    return { resource: 'articles', params: [slug] };
  }
  if (route[0] === 'profiles' && route[1] !== undefined) {
    return { resource: 'profiles', params: [routeParam(route[1])] };
  }

  const clean = String(url).replace(/^https?:\/\/[^/]+/, '');
  const parts = clean.split('?')[0].split('/').filter(Boolean);
  const params = [];
  const statics = [];
  for (const p of parts) {
    const varName = p.replace(/[{}]/g, '').trim();
    if (['host', 'base', 'baseUrl', 'BASE_URL'].includes(varName)) continue;
    if (/^\{\{/.test(p)) {
      params.push(varName.replace(/^:/, ''));
    } else if (p.includes('{{')) {
      params.push(p);
    } else if (/^:/.test(p) || /^\d+$/.test(p) || p.startsWith(MARK)) {
      params.push(p.replace(/^:/, ''));
    } else if (!['api', 'v1', 'v2', 'v3'].includes(p)) {
      statics.push(p);
    }
  }
  return { resource: statics[statics.length - 1] || 'root', params };
}

const ACTION_BY_METHOD = { GET: 'list', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete', HEAD: 'head' };
const PARAM_NAMES = {
  articles: ['slug'],
  comments: ['slug', 'id'],
  profiles: ['username'],
  users: ['username'],
  user: ['username'],
};
const ARG_NAMES = { articles: 'slug', comments: 'slug', profiles: 'username', users: 'username', user: 'username' };
const PATH_ACTIONS = new Set(['login', 'logout', 'register', 'follow', 'feed', 'favorite']);

export function capabilityOf(method, url) {
  const route = routeParts(url);
  const { resource, params } = splitUrl(url);
  if (route[0] === 'articles') {
    if (route[1] === 'feed') return { capability: 'articles.feed', resource: 'articles', params: [] };
    if (route[2] === 'favorite') {
      return { capability: method === 'DELETE' ? 'articles.unfavorite' : 'articles.favorite', resource: 'articles', params };
    }
    if (route[2] === 'comments') {
      const action = route.length > 3 && method === 'DELETE'
        ? 'delete'
        : ({ GET: 'list', POST: 'create' }[method] || ACTION_BY_METHOD[method] || 'call');
      return { capability: `comments.${action}`, resource: 'comments', params };
    }
    if (route.length === 1) return { capability: `articles.${ACTION_BY_METHOD[method] || 'call'}`, resource: 'articles', params };
    if (route.length === 2) {
      const action = method === 'GET' ? 'get' : (ACTION_BY_METHOD[method] || 'call');
      return { capability: `articles.${action}`, resource: 'articles', params };
    }
  }
  if (route[0] === 'profiles' && route.length === 2) {
    return { capability: 'profiles.get', resource: 'profiles', params };
  }
  if (route[0] === 'profiles' && route[2] === 'follow') {
    const action = method === 'DELETE' ? 'unfollow' : (method === 'POST' ? 'follow' : ACTION_BY_METHOD[method] || 'call');
    return { capability: `profiles.${action}`, resource: 'profiles', params };
  }

  const raw = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('/').filter(Boolean);
  const lastRaw = raw[raw.length - 1] || '';
  const last = lastRaw.replace(/[{}]/g, '');
  if (PATH_ACTIONS.has(last)) {
    const statics = raw.filter((p) => p !== last && !p.includes('{{') && !/^:/.test(p) && !/^\d+$/.test(p) && !['api', 'v1', 'v2', 'v3'].includes(p));
    const owner = statics[statics.length - 1] || resource;
    const action = (last === 'favorite' && method === 'DELETE') ? 'unfavorite'
      : (last === 'follow' && method === 'DELETE') ? 'unfollow'
        : last;
    return { capability: `${owner}.${action}`, resource: owner, params };
  }
  if (method === 'GET') {
    const lastIsParam = lastRaw.includes('{{') || /^:/.test(lastRaw) || /^\d+$/.test(lastRaw);
    const action = lastIsParam ? 'get' : (resource && resource.endsWith('s') ? 'list' : 'get');
    return { capability: `${resource}.${action}`, resource, params };
  }
  return { capability: `${resource}.${ACTION_BY_METHOD[method] || 'call'}`, resource, params };
}

function parseAssertText(rest) {
  const s = rest.trim();
  let m = s.match(/^==\s*(.+)$/);
  if (m) return { op: 'equals', raw: m[1] };
  if (s === 'isString') return { op: 'is_string' };
  if (s === 'isList') return { op: 'is_list' };
  if (s === 'not isEmpty') return { op: 'not_empty' };
  m = s.match(/^count\s*>=\s*(\d+)$/);
  if (m) return { op: 'count_gte', raw: m[1] };
  m = s.match(/^count\s*==\s*(\d+)$/);
  if (m) return { op: 'count_equals', raw: m[1] };
  m = s.match(/^contains\s+(.+)$/);
  if (m) return { op: 'contains', raw: m[1] };
  return { op: null, raw: s };
}

function literalOf(raw) {
  if (raw === undefined) return undefined;
  const t = String(raw).trim();
  if (t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  try {
    return JSON.parse(t);
  } catch {
    return t.replace(/^"|"$/g, '');
  }
}

/** 解析一个 hurl 文件 → 请求块数组。不执行、不联网。 */
export function parseHurl(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let cur = null;
  let section = null; // 'captures' | 'asserts' | null
  const bodyLines = [];

  const closeBody = () => {
    if (!cur || bodyLines.length === 0) return;
    const raw = bodyLines.join('\n');
    bodyLines.length = 0;
    cur.body_text = raw;
    try {
      cur.body = JSON.parse(raw.replace(VAR_RE, (_, n) => `${MARK}${n}${MARK}`));
    } catch {
      cur.body = null;
    }
  };

  for (const line of lines) {
    const t = line.trim();
    const req = t.match(/^([A-Z]+)\s+(\S+)$/);
    if (req && METHODS.has(req[1])) {
      closeBody();
      cur = { method: req[1], url: req[2], headers: {}, status: null, captures: [], asserts: [], body: null, body_text: null, comment: null };
      blocks.push(cur);
      section = null;
      continue;
    }
    if (!cur) continue;
    if (t.startsWith('#')) {
      if (!cur.comment) cur.comment = t.replace(/^#+\s*/, '');
      continue;
    }
    if (t === '[Captures]') { closeBody(); section = 'captures'; continue; }
    if (t === '[Asserts]') { closeBody(); section = 'asserts'; continue; }
    if (t.startsWith('[') && t.endsWith(']')) { closeBody(); section = 'other'; continue; }
    if (/^HTTP\s+\d{3}$/.test(t)) { closeBody(); cur.status = Number(t.split(/\s+/)[1]); section = null; continue; }
    if (t === '') { closeBody(); continue; }
    if (section === 'captures') {
      const m = t.match(/^([A-Za-z0-9_]+)\s*:\s*jsonpath\s+"([^"]+)"$/);
      if (m) cur.captures.push({ name: m[1], path: m[2] });
      continue;
    }
    if (section === 'asserts') {
      const m = t.match(/^jsonpath\s+"([^"]+)"\s+(.+)$/);
      if (m) { const a = parseAssertText(m[2]); cur.asserts.push({ path: m[1], ...a }); }
      else cur.asserts.push({ path: null, op: null, raw: t });
      continue;
    }
    const h = t.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    if (h && cur.body === null && bodyLines.length === 0 && !t.startsWith('{') && !t.startsWith('[')) {
      cur.headers[h[1].toLowerCase()] = h[2];
      continue;
    }
    if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || bodyLines.length > 0) {
      bodyLines.push(line);
    }
  }
  closeBody();
  return blocks;
}

/** 把解析结果转成案例草稿 + 一份待办清单。 */
export function toCases(blocks, opts = {}) {
  const baseId = opts.id || 'imported';
  const as = opts.as || 'user';
  const uid = opts.uid || '000000';
  const steps = [];
  const assertions = [];
  const todo = [];
  const capturedAt = new Map();


  // 身份由注册/登录提交的 username 或 email 决定，token 变量名不算身份。
  const roleByUsername = new Map();
  const roleByEmail = new Map();
  const roleOfStep = new Map();
  let identityCount = 0;
  blocks.forEach((b, i) => {
    const { capability: cap } = capabilityOf(b.method, b.url);
    if (cap !== 'users.create' && cap !== 'users.login') return;
    const user = (b.body && b.body.user) || b.body || {};
    const username = user.username ? String(user.username) : '';
    const email = user.email ? String(user.email) : '';
    const knownRole = (username && roleByUsername.get(username)) || (email && roleByEmail.get(email));
    const role = knownRole || (identityCount === 0 ? as : 'user2');
    if (!knownRole) identityCount += 1;
    if (username) roleByUsername.set(username, role);
    if (email) roleByEmail.set(email, role);
    roleOfStep.set(i, role);
  });
  // 令牌轮换不会创建新身份。每个 token 捕获继承该请求实际使用的角色，
  // 包括 PUT /user 返回的 updated_token 一类普通更新响应。
  const varRole = new Map();
  blocks.forEach((b, i) => {
    const cap = capabilityOf(b.method, b.url).capability;
    const establishesIdentity = cap === 'users.create' || cap === 'users.login';
    const authVar = String(b.headers.authorization || b.headers.Authorization || '').match(/\{\{\s*(\w+)\s*\}\}/);
    const requestRole = establishesIdentity
      ? (roleOfStep.get(i) || as)
      : (authVar ? (varRole.get(authVar[1]) || as) : 'anonymous');
    for (const capture of b.captures) {
      if (/token/i.test(capture.name)) varRole.set(capture.name, requestRole);
    }
  });
  const roleOfTokenVar = (name) => varRole.get(name) || as;
  blocks.forEach((b, i) => {
    if (b.url && /\{\{\s*host\s*\}\}/.test(b.url) === false && /^https?:/.test(b.url) === false) {
      // 相对路径也接受
    }
    if (!b.status) { todo.push(`第 ${i + 1} 个请求没有 HTTP 状态行，整块跳过：${b.method} ${b.url}`); return; }
    if (b.status >= 500) { todo.push(`第 ${i + 1} 个请求断言 ${b.status}（服务端错误），不写成案例`); return; }
    const { capability, params } = capabilityOf(b.method, b.url);
    const stepId = `s${steps.length + 1}`;
    const args = {};
    const body = b.body && b.body.user !== undefined ? b.body.user
      : b.body && b.body.article !== undefined ? b.body.article
        : b.body && b.body.comment !== undefined ? b.body.comment
          : b.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body)) {
        // null 是**有意义的实参**（`{"bio": null}` 就是清空），只有 undefined 才丢
        if (v !== undefined) args[k] = deepFill(v, uid);
      }
    }
    // 查询串是接口参数（`?author=page_1&limit=1`），丢了分页断言就会对着全量列表比大小。
    const qs = String(b.url).split('?')[1] || '';
    for (const pair of qs ? qs.split('&') : []) {
      const [k, v = ''] = pair.split('=');
      if (!k) continue;
      const name = decodeURIComponent(k);
      const raw = decodeURIComponent(v);
      const filled = raw.replace(VAR_RE, (_, n) => (n === 'uid' ? uid : `${MARK}${n}${MARK}`));
      const plain = filled.replace(MARK_RE, uid);
      args[name] = /^-?\d+$/.test(plain) ? Number(plain) : plain;
    }
    if (Array.isArray(params) && params.length > 0) {
      for (const [pos, p] of params.entries()) {
        const res = capability.split('.')[0];
        const argName = (PARAM_NAMES[res] || [])[pos] || p;
        const text = String(p);
        if (text.includes(MARK) || text.includes('{{')) {
          // 含变量的路径段是具体值（如 unknown-slug-{{uid}}），不是捕获名。
          const plain = text.replace(VAR_RE, (_, n) => (n === 'uid' ? uid : `${MARK}${n}${MARK}`));
          args[argName] = deepFill(plain, uid);
          continue;
        }
        const src = capturedAt.get(p);
        if (src) {
          args[argName] = src;
        } else if (/^\d+$/.test(text)) {
          // 数字路径段（如评论 ID）是字面参数，不需要在前文捕获。
          args[argName] = Number(text);
        } else if (text.startsWith(':')) {
          todo.push(`第 ${i + 1} 个请求要路径参数 {{${text.slice(1)}}}，但没有更早的捕获，参数留空`);
        } else if (['slug', 'username', 'id'].includes(text)) {
          todo.push(`第 ${i + 1} 个请求要路径参数 {{${text}}}，但没有更早的捕获，参数留空`);
        } else {
          // RealWorld 的静态 slug（如 /articles/some-slug）也是契约路径参数。
          args[argName] = text;
        }
      }
    }
    // 注册与登录不是匿名动作：它就是在确立这个角色的身份，后续步骤才以这个身份执行。
    // 写成 anonymous 会让适配器把新 token 记在 anonymous 名下，后面 as=user 的步骤还在用复位的旧 token。
    const establishesIdentity = capability === 'users.create' || capability === 'users.login';
    const authVar = String(b.headers.authorization || b.headers.Authorization || '').match(/\{\{\s*(\w+)\s*\}\}/);
    const ownToken = b.captures.find((c) => varRole.has(c.name));
    const role = establishesIdentity
      ? (roleOfStep.get(i) || as)
      : (authVar ? roleOfTokenVar(authVar[1]) : 'anonymous');
    const expected = b.status >= 400 ? 'rejected' : 'applied';
    const step = { id: stepId, capability, as: role, expected_outcome: expected };
    if (Object.keys(args).length > 0) step.arguments = args;
    // 捕获不是这一步的输入，而是**后面某一步的实参**。所以这里只记账，
    // 等后面遇到 {{name}} 时再写成 `$sN.field` 引用（bindings 的语义是「本步引用前面某步的输出」）。
    for (const c of b.captures) {
      // 引用写的是**返回体里的路径**：运行器的 outputs 存的是 res.payload（src/runner.mjs:273），
      // 不是适配器另算的 outputs 映射。所以 `$.article.slug` 要写成 `$s2.article.slug`，
      // 少写中间那段就会解析成 undefined。
      const rel = String(c.path).replace(/^\$\.?/, '');
      capturedAt.set(c.name, `$${stepId}.${rel}`);
    }
    steps.push(step);

    for (const a of b.asserts) {
      if (!a.op || !a.path) { todo.push(`第 ${i + 1} 步的断言读不懂，留给人看：${a.raw || ''}`); continue; }
      const raw = a.raw === undefined ? undefined : String(a.raw).replace(VAR_RE, (_, n) => (n === 'uid' ? uid : `${MARK}${n}${MARK}`));
      const assertion = { kind: 'payload', step: steps.length, path: a.path, op: a.op };
      // 期望值本身是捕获来的（`== "{{slug2}}"`），写成跨步引用，而不是把占位符当字面量。
      const rawText = a.raw === undefined ? '' : String(a.raw).trim().replace(/^"|"$/g, '');
      const varOnly = rawText.match(/^\{\{\s*(\w+)\s*\}\}$/);
      if (varOnly && capturedAt.has(varOnly[1])) {
        assertion.value_from = capturedAt.get(varOnly[1]);
      } else if (a.op === 'equals' || a.op === 'contains') assertion.value = literalOf(raw);
      if (a.op === 'count_gte' || a.op === 'count_equals') assertion.value = Number(raw);
      if (JSON.stringify(assertion).includes('}}')) { todo.push(`第 ${i + 1} 步断言里还有变量没替换：${a.path}`); continue; }
      assertions.push(assertion);
    }
  });

  const c = {
    schema_version: 'agent-web/0.1',
    id: `realworld/${baseId}`,
    title: `从 hurl 转来：${baseId}`,
    environment: { adapter: 'realworld', seed: {} },
    task: {
      natural_goal: opts.goal || `按 hurl 套件 ${baseId} 的顺序重放一遍，并检查每一步的返回体。`,
      goal_assertions: assertions,
      invariants: [],
    },
    reference_trajectory: steps,
    observability: { declared_scopes: [] },
    draft: {
      status: 'unconfirmed',
      generated_by: 'agent-web import hurl',
      note: todo.length > 0 ? `${todo.length} 处需要人看，见同目录的 .todo.md` : '全部请求与断言都转成了案例结构',
    },
  };
  return { case: c, todo };
}

export function formatTodo(todo) {
  if (!todo.length) return '';
  const lines = ['# 转换时没做完的地方', '', '以下每一条都是转换器**不肯猜**的地方：', ''];
  todo.forEach((t, i) => lines.push(`${i + 1}. ${t}`));
  lines.push('');
  return lines.join('\n');
}

export function writeImport(inputDir, outDir, opts = {}) {
  const files = fs.statSync(inputDir).isDirectory()
    ? fs.readdirSync(inputDir).filter((f) => f.endsWith('.hurl')).sort().map((f) => path.join(inputDir, f))
    : [inputDir];
  fs.mkdirSync(outDir, { recursive: true });
  const made = [];
  for (const file of files) {
    const blocks = parseHurl(fs.readFileSync(file, 'utf8'));
    const name = path.basename(file, '.hurl');
    const { case: c, todo } = toCases(blocks, { ...opts, id: name });
    const target = path.join(outDir, `${name}.json`);
    fs.writeFileSync(target, `${JSON.stringify(c, null, 2)}\n`, 'utf8');
    if (todo.length > 0) fs.writeFileSync(path.join(outDir, `${name}.todo.md`), formatTodo(todo), 'utf8');
    made.push({
      file: target, name,
      steps: c.reference_trajectory.length,
      assertions: c.task.goal_assertions.length,
      todo: todo.length,
    });
  }
  return made;
}

export function formatImport(made) {
  if (made.length === 0) return '没有可转换的 .hurl 文件';
  const w = Math.max(...made.map((m) => m.name.length));
  const lines = [`从 hurl 转了 ${made.length} 个套件：`, ''];
  for (const m of made) {
    lines.push(`  ${m.name.padEnd(w)}  ${m.steps} 步 / ${m.assertions} 条断言${m.todo > 0 ? ` / ${m.todo} 处待办` : ''}`);
  }
  const steps = made.reduce((n, m) => n + m.steps, 0);
  const asserts = made.reduce((n, m) => n + m.assertions, 0);
  const todo = made.reduce((n, m) => n + m.todo, 0);
  lines.push('', `合计 ${steps} 步、${asserts} 条断言${todo > 0 ? `、${todo} 处待办（写在同名 .todo.md 里）` : ''}`);
  lines.push('', '下一步：accept 之后才能出判决。');
  return lines.join('\n');
}

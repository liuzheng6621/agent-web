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

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function expandVars(text, vars) {
  return String(text).replace(VAR_RE, (_, name) => (name in vars ? String(vars[name]) : `__${name}__`));
}

/** 从 URL 里剥出静态资源名与路径参数。`/api/articles/{{slug}}` → { resource:'articles', params:['slug'] } */
export function splitUrl(url) {
  const clean = String(url).replace(/^https?:\/\/[^/]+/, '');
  const parts = clean.split('?')[0].split('/').filter(Boolean);
  const params = [];
  const statics = [];
  for (const p of parts) {
    const varName = p.replace(/[{}]/g, '').trim();
    if (['host', 'base', 'baseUrl', 'BASE_URL'].includes(varName)) continue;
    if (/^\{\{/.test(p) || /^:/.test(p) || /^\d+$/.test(p) || /^__/.test(p)) {
      params.push(varName.replace(/^:/, ''));
    } else if (!['api', 'v1', 'v2', 'v3'].includes(p)) {
      statics.push(p);
    }
  }
  return { resource: statics[statics.length - 1] || 'root', params };
}

const ACTION_BY_METHOD = { GET: 'list', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete', HEAD: 'head' };

export function capabilityOf(method, url) {
  const { resource, params } = splitUrl(url);
  const action = method === 'GET' && params.length > 0 ? 'get' : ACTION_BY_METHOD[method] || 'call';
  return { capability: `${resource}.${action}`, resource, params };
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
      cur.body = JSON.parse(raw.replace(VAR_RE, (_, n) => `__${n}__`));
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
        if (v !== undefined && v !== null) args[k] = typeof v === 'string' ? v.replace(/__([A-Za-z0-9_]+)__/g, uid) : v;
      }
    } else if (Array.isArray(params) && params.length > 0) {
      for (const p of params) {
        const src = capturedAt.get(p);
        if (src) args[`${p}`] = src;
        else todo.push(`第 ${i + 1} 个请求要路径参数 {{${p}}}，但没有更早的捕获，参数留空`);
      }
    }
    const role = (b.headers.authorization || b.headers.Authorization) ? as : 'anonymous';
    const expected = b.status >= 400 ? 'rejected' : 'applied';
    const step = { id: stepId, capability, as: role, expected_outcome: expected };
    if (Object.keys(args).length > 0) step.arguments = args;
    const binds = {};
    for (const c of b.captures) {
      const field = String(c.path).split('.').pop().replace(/\[.*$/, '');
      capturedAt.set(c.name, `$${stepId}.${field}`);
      binds[c.name] = `$${stepId}.${field}`;
    }
    if (Object.keys(binds).length > 0) step.captures = binds;
    steps.push(step);

    for (const a of b.asserts) {
      if (!a.op || !a.path) { todo.push(`第 ${i + 1} 步的断言读不懂，留给人看：${a.raw || ''}`); continue; }
      const raw = a.raw === undefined ? undefined : String(a.raw).replace(VAR_RE, (_, n) => (n === 'uid' ? uid : `__${n}__`));
      const assertion = { kind: 'payload', step: steps.length, path: a.path, op: a.op };
      if (a.op === 'equals' || a.op === 'contains') assertion.value = literalOf(raw);
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

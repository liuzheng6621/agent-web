/**
 * learn：把一份 traffic.jsonl 学成四件东西。
 *
 *   ① adapter.yml     声明式规格（能力表 / 视图字段表 / 错误码表 / 鉴权 / 复位）
 *   ② twin.json       回放孪生的原料（初态 + 每步写操作的状态差）
 *   ③ cases/*.json    案例草稿（每条写操作链一条，断言只写机器敢写的）
 *   ④ unclassified.jsonl  认不出的请求，原样留给人看
 *
 * 原则：
 *   - 全是观察，没有想象。认不出的进 ④，不猜。
 *   - 易变字段（id / 时间 / token）不进断言、不进孪生匹配键。
 *   - 产出的案例一律 draft：不确认不出判决（草稿闸门对机器产出同样生效）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { stringifyYaml } from './yaml.mjs';

export const LEARN_VERSION = 'agent-web/learn-1';
const ID_LIKE = /^(\d+|[0-9a-f]{8,}|[0-9a-f-]{36})$/i;
const VOLATILE_KEY = /(^|_)(id|uuid|guid|token|created|updated|time|at|nonce|session)(_|$)/i;

export function readTraffic(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      try { return JSON.parse(l); } catch { return { seq: i, unparsable: true }; }
    })
    .filter((r) => !r.unparsable)
    .map((r) => {
      const out = { ...r };
      for (const k of ['req_body', 'res_body']) {
        if (typeof out[k] === 'string') {
          try { out[k] = JSON.parse(out[k]); } catch { out[k] = null; }
        }
      }
      return out;
    });
}

function templateOf(pathSeg) {
  return pathSeg
    .split('/')
    .map((s) => (ID_LIKE.test(s) ? '{id}' : s))
    .join('/');
}

function rowsOf(body) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    for (const v of Object.values(body)) {
      if (Array.isArray(v) && (v.length === 0 || v.every(function(x) { return x && typeof x === 'object'; }))) return v;
    }
    for (const v of Object.values(body)) { if (Array.isArray(v)) return v; }
  }
  return null;
}

function keySet(rows) {
  const ks = new Set();
  for (const r of rows) for (const k of Object.keys(r || {})) ks.add(k);
  return [...ks].sort();
}

function volatileField(rows, key) {
  if (VOLATILE_KEY.test(key)) return true;
  const vals = new Set(rows.map(function(r) { return JSON.stringify((r || {})[key] ?? null); }));
  return vals.size > Math.max(1, Math.ceil(rows.length * 0.7));
}

const IGNORED_SEGMENTS = new Set(['api', 'rest', 'v1', 'v2', 'v3', 'v4', 'public', 'internal']);

const ACTION_WORDS = new Set([
  'complete', 'cancel', 'approve', 'reject', 'close', 'reopen', 'start', 'stop',
  'accept', 'ready', 'pick', 'pay', 'refund', 'upload', 'export', 'import',
  'archive', 'restore', 'activate', 'disable',
]);

function segmentsOf(template) {
  return template.split('/').filter(function(s) { return s && !s.startsWith('{') && !IGNORED_SEGMENTS.has(s); });
}

function resourceName(template) {
  const segs = segmentsOf(template);
  if (segs.length >= 2 && ACTION_WORDS.has(segs[segs.length - 1])) return segs[segs.length - 2];
  return segs[segs.length - 1] || 'root';
}

function capabilityId(method, template, name) {
  const hasParam = template.includes('{id}');
  const map = { GET: hasParam ? 'get' : 'list', POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
  const verb = map[method] || 'call';
  const segs = segmentsOf(template);
  const tail = segs[segs.length - 1];
  if (segs.length >= 2 && ACTION_WORDS.has(tail)) return name + '.' + tail;
  return name + '.' + verb;
}

export function learnTraffic(records, options) {
  options = options || {};
  const unclassified = [];
  const clusters = new Map();
  for (const r of records) {
    if (!r || !r.method || !r.path) { unclassified.push({ reason: 'missing method/path', record: r }); continue; }
    if (r.status === 599) { unclassified.push({ reason: 'upstream unreachable', record: { seq: r.seq, method: r.method, path: r.path } }); continue; }
    const tpl = templateOf(r.path);
    const key = r.method + ' ' + tpl;
    if (!clusters.has(key)) clusters.set(key, { method: r.method, template: tpl, records: [], resShapes: [] });
    const c = clusters.get(key);
    c.records.push(r);
    const rows = rowsOf(r.res_body);
    if (rows) c.resShapes.push({ rows: rows, keys: keySet(rows) });
  }

  // view collections: GET + shape stable
  const collections = new Map();
  for (const [key, c] of clusters) {
    if (c.method !== 'GET' || c.resShapes.length === 0) continue;
    const filled = c.resShapes.filter(function(s) { return s.rows.length > 0; });
    if (filled.length === 0) continue;
    const keys = filled[0].keys.join(',');
    const stable = filled.every(function(s) { return s.keys.join(',') === keys; });
    if (!stable) continue;
    const allRows = filled.flatMap(function(s) { return s.rows; });
    if (allRows.length === 0) continue;
    const name = c.template.split('/').filter(Boolean).pop() || 'items';
    const fields = {};
    const notes = [];
    for (const k of filled[0].keys) {
      fields[k] = '$.' + k;
      if (volatileField(allRows, k)) notes.push(k);
    }
    collections.set(name, { from: 'GET ' + c.template, fields: fields, volatile: notes, source: key });
  }

  // capabilities
  const caps = {};
  for (const [key, c] of clusters) {
    const name = resourceName(c.template);
    const id = capabilityId(c.method, c.template, name);
    const cap = {};
    cap[c.method] = c.template;
    const statuses = c.records.map(function(r) { return r.status; });
    if (statuses.every(function(s) { return [404, 405, 501].includes(s); })) cap.unsupported = true;
    caps[id] = cap;
  }

  // errors table
  const errors = {};
  for (const r of records) {
    const code = r.res_body && (r.res_body.code ?? r.res_body.errorCode ?? r.res_body.errno);
    if (code === undefined || code === null) continue;
    if (r.status >= 400 && r.status < 500) errors[String(code)] = 'rejected';
    if (r.status >= 500) errors[String(code)] = 'infra_error';
  }
  if (!errors['4xx']) errors['4xx'] = 'rejected';
  if (!errors['5xx']) errors['5xx'] = 'infra_error';
  errors['default'] = 'applied';

  // auth
  let auth = null;
  const loginRec = records.find(function(r) { return r.method === 'POST' && r.status < 300 && r.res_body && typeof r.res_body === 'object' && (r.res_body.token || r.res_body.accessToken); });
  if (loginRec) {
    const tokenKey = loginRec.res_body.token ? 'token' : 'accessToken';
    const userField = Object.keys(loginRec.req_body || {}).find(function(k) { return /user|name|account/i.test(k); }) || 'username';
    auth = {
      login: 'POST ' + loginRec.path,
      user_field: userField,
      pass_field: Object.keys(loginRec.req_body || {}).find(function(k) { return /pass|pwd/i.test(k); }) || 'password',
      token: '$.' + tokenKey,
      accounts: {
        recorded: {
          user: (loginRec.req_body || {})[userField] || 'REPLACE_ME',
          pass_env: 'TAP_TARGET_PASSWORD',
        },
      },
    };
  }

  const roles = auth ? ['recorded'] : ['anonymous'];
  return { clusters, collections, capabilities: caps, errors, auth, roles, unclassified, records };
}

function projectRows(rows, fields) {
  return rows.map(function(row) {
    const out = {};
    for (const k of Object.keys(fields)) out[k] = (row || {})[k] ?? null;
    return out;
  });
}

function pathArgsOf(record, template) {
  const tSegs = template.split('/').filter(Boolean);
  const pSegs = record.path.split('/').filter(Boolean);
  const args = {};
  tSegs.forEach(function(s, i) {
    if (s.startsWith('{') && s.endsWith('}')) args[s.slice(1, -1)] = pSegs[i];
  });
  return args;
}

function getIndex(records, collections, colBySource) {
  const raw = {};
  for (const name of [...collections.keys()]) raw[name] = [];
  records.forEach(function(r, i) {
    if (r.method !== 'GET' || r.status >= 300) return;
    const col = colBySource.get(r.method + ' ' + templateOf(r.path));
    if (col) { if (!raw[col]) raw[col] = []; raw[col].push(i); }
  });
  const idx = {};
  for (const name of Object.keys(raw)) {
    const arr = raw[name];
    let cur = 0;
    idx[name] = function(pos) {
      while (cur < arr.length && arr[cur] <= pos) cur += 1;
      return cur < arr.length ? records[arr[cur]] : null;
    };
  }
  return idx;
}

function matchKeyOf(capId, body, pathStr, tpl) {
  const bodyKeys = Object.keys(body || {}).sort().map(function(k) { return k + '=' + JSON.stringify(body[k]); }).join(',');
  return capId + '|' + bodyKeys;
}

export function buildTwin(learned) {
  const { records, collections, capabilities } = learned;
  const state = {};
  const initState = {};
  let initial = null;
  const steps = [];
  const colBySource = new Map();
  for (const [name, def] of collections) colBySource.set(def.source, name);
  const getAfter = getIndex(records, collections, colBySource);
  const projectOf = function(name) { return function(rows) { return projectRows(rows, collections.get(name).fields); }; };

  records.forEach(function(r, idx) {
    const tpl = templateOf(r.path);
    const col = colBySource.get(r.method + ' ' + tpl);
    if (r.method === 'GET' && col && r.status < 300) {
      const rows = rowsOf(r.res_body);
      if (rows) {
        state[col] = projectOf(col)(rows);
        if (!initState[col]) initState[col] = JSON.parse(JSON.stringify(state[col]));
      }
      return;
    }
    if (r.method === 'GET') return;
    if (initial === null) initial = JSON.parse(JSON.stringify(state));
    const capId = Object.keys(capabilities).find(function(id) {
      const c = capabilities[id];
      const m = Object.keys(c).find(function(k) { return k !== 'unsupported'; });
      return m && c[m] === tpl && m === r.method;
    });
    if (!capId) return;
    // 登录不是业务步：鉴权由适配器的 auth 承担，孪生与案例都不含它，否则两边游标错位
    if (/^login[.]/.test(capId)) return;
    const before = JSON.parse(JSON.stringify(state));
    const after = JSON.parse(JSON.stringify(state));
    for (const [name] of collections) {
      const ng = getAfter[name] ? getAfter[name](idx) : null;
      if (ng) {
        const rows = rowsOf(ng.res_body);
        if (rows) after[name] = projectOf(name)(rows);
      }
    }
    const delta = {};
    for (const name of Object.keys(after)) {
      if (JSON.stringify(after[name]) !== JSON.stringify(before[name] ?? null)) delta[name] = after[name];
    }
    for (const [name, rows] of Object.entries(after)) state[name] = rows;
    steps.push({
      capability: capId,
      method: r.method,
      path: r.path,
      body: r.req_body && typeof r.req_body === 'object' ? r.req_body : {},
      args: pathArgsOf(r, tpl),
      outcome: r.status < 400 ? 'applied' : 'rejected',
      code: r.res_body && r.res_body.code !== undefined ? String(r.res_body.code) : String(r.status),
      delta: delta,
      _matchKey: matchKeyOf(capId, r.req_body, r.path, tpl),
    });
  });
  return {
    version: LEARN_VERSION,
    roles: learned.roles,
    collections: [...collections.keys()],
    capabilities: Object.keys(capabilities),
    initial: Object.keys(initState).length ? initState : initial || JSON.parse(JSON.stringify(state)),
    final: JSON.parse(JSON.stringify(state)),
    steps: steps,
  };
}

export function buildCases(learned, twin, options) {
  options = options || {};
  const writes = twin.steps.filter(function(s) { return !/^login[.]/.test(s.capability); });
  if (writes.length === 0) return [];
  const steps = writes.map(function(s, i) {
    return {
      id: 's' + (i + 1),
      capability: s.capability,
      as: learned.roles[0],
      expected_outcome: s.outcome,
      arguments: { ...s.args, ...s.body },
    };
  });
  const assertions = [];
  const silent = [];
  for (const name of twin.collections) {
    const before = twin.initial[name] || [];
    const after = twin.final[name] || [];
    if (after.length - before.length !== 0) {
      assertions.push({ kind: 'count_delta', selector: { collection: name }, delta: after.length - before.length });
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      silent.push(name);
    }
  }
  const slug = (options.name || 'tap').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const chainLabel = writes.map(function(w) { return w.capability; }).join(' -> ');
  const silentNote = silent.length
    ? '集合 ' + silent.join('/') + ' 内容变过但行数没变，机器不知道哪个值是该的，没写断言——要保就人手补一条 field_equals。'
    : '';
  return [
    {
      schema_version: 'agent-web/0.1',
      id: slug + '/recorded-chain',
      task: {
        natural_goal: '复刻录制到的 ' + writes.length + ' 步操作链：' + chainLabel,
        allowed_capabilities: twin.capabilities,
        goal_assertions: assertions,
        invariants: [],
      },
      reference_trajectory: steps,
      draft: {
        status: options.accept ? 'confirmed' : 'unconfirmed',
        note: 'learn 产出（' + LEARN_VERSION + '）。断言只有计数差与未变两类；易变字段没有进断言。' + silentNote + '确认：agent-web accept ' + slug + '/recorded-chain --by=<名字>',
        ...(options.accept ? { reviewed_by: options.accept, reviewed_at: new Date().toISOString() } : {}),
      },
      labels: { source: 'learn', writes: writes.filter(function(w) { return w.outcome === 'applied'; }).length },
    },
  ];
}

export function emitSpec(learned, options) {
  options = options || {};
  const { collections, capabilities, errors, auth, roles } = learned;
  const resetCall = learned.records.find(function(r) { return /reset/i.test(r.path) && r.method === 'POST' && r.status < 300; });
  const spec = {
    adapter: options.name || 'tap-target',
    version: '1.0.0',
    evidence: 'inferred',
    description: 'learn 产出（' + LEARN_VERSION + '）：全部来自录制观察，标 inferred 不是事实',
    base_url: { env: options.env || 'TAP_TARGET_URL' },
    roles: roles,
  };
  if (auth) spec.auth = auth;
  spec.reset = resetCall
    ? { strategy: 'reseed', calls: [{ method: 'POST', path: resetCall.path, as: roles[0] }] }
    : { strategy: 'reseed', calls: [], note: '录制里没看到复位接口：补一条，或改成 identity 并给每个角色一个账号' };
  spec.capabilities = {};
  for (const [id, cap] of Object.entries(capabilities)) {
    spec.capabilities[id] = { ...cap, as: roles };
  }
  spec.view = {};
  for (const [name, def] of collections) {
    spec.view[name] = { from: def.from, fields: def.fields };
    if (def.volatile && def.volatile.length) spec.view[name].volatile = def.volatile;
  }
  spec.errors = errors;
  return spec;
}

export function writeLearnOut(outDir, learned, options) {
  options = options || {};
  fs.mkdirSync(outDir, { recursive: true });
  const twin = buildTwin(learned);
  const cases = buildCases(learned, twin, options);
  const spec = emitSpec(learned, options);
  fs.writeFileSync(path.join(outDir, 'adapter.yml'), stringifyYaml(spec), 'utf8');
  fs.writeFileSync(path.join(outDir, 'twin.json'), JSON.stringify(twin, null, 2), 'utf8');
  const casesDir = path.join(outDir, 'cases');
  fs.mkdirSync(casesDir, { recursive: true });
  for (const c of cases) {
    fs.writeFileSync(path.join(casesDir, c.id.replace(/\//g, '__') + '.json'), JSON.stringify(c, null, 2), 'utf8');
  }
  fs.writeFileSync(
    path.join(outDir, 'unclassified.jsonl'),
    learned.unclassified.map(function(u) { return JSON.stringify(u); }).join('\n') + (learned.unclassified.length ? '\n' : ''),
    'utf8',
  );
  return { twin: twin, cases: cases, spec: spec, files: ['adapter.yml', 'twin.json', 'unclassified.jsonl', ...cases.map(function(c) { return 'cases/' + c.id.replace(/\//g, '__') + '.json'; })] };
}

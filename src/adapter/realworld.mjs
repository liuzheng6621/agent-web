// RealWorld 适配器：一份契约，990+ 个实现。
//
// 契约见 examples/realworld/openapi.yml（19 个端点，来自 realworld-apps/realworld）。
// 内置名 `realworld`，地址取 REALWORLD_BASE_URL，默认 http://127.0.0.1:8299。
//
// 三个必须说清楚的设计决定：
// 1) **这个契约没有复位接口**。所以 reset 用「每次运行注册两个全新用户」做隔离，
//    而不是假装把库清空。角色是真用户：user / user2 各自持 token。
// 2) 越权类断言必须有第二个用户可用 —— `user` 拿别人的文章 slug 去改，得 403。
// 3) 返回体一律回 payload：hurl 语料的断言全是响应体层面的（payload 断言读的就是它）。



const BASE = () => (process.env.REALWORLD_BASE_URL || 'http://127.0.0.1:8299').replace(/\/$/, '');
const API = () => `${BASE()}/api`;

async function http(method, path, { token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Token ${token}`;
  const res = await fetch(`${API()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  return { status: res.status, payload };
}

const NAME = (runId, suffix) => `rw_${runId}_${suffix}`.replace(/[^A-Za-z0-9_]/g, '');
const PASSWORD = 'pw12345678';

let runSeq = 0;

export function createRealWorldAdapter(opts = {}) {
  const runs = new Map();
  const history = [];
  const capabilityBase = [
    { id: 'users.create', kind: 'write', args: { username: 'string', email: 'string', password: 'string' }, roles: ['anonymous'] },
    { id: 'users.login', kind: 'write', args: { email: 'string', password: 'string' }, roles: ['anonymous'] },
    { id: 'user.get', kind: 'read', args: {}, roles: ['user', 'user2'] },
    { id: 'user.update', kind: 'write', args: { bio: 'string?', image: 'string?', email: 'string?', password: 'string?' }, roles: ['user', 'user2'] },
    { id: 'profiles.get', kind: 'read', args: { username: 'string' }, roles: ['anonymous', 'user', 'user2'] },
    { id: 'profiles.follow', kind: 'write', args: { username: 'string' }, roles: ['user', 'user2'] },
    { id: 'profiles.unfollow', kind: 'write', args: { username: 'string' }, roles: ['user', 'user2'] },
    { id: 'tags.list', kind: 'read', args: {}, roles: ['anonymous', 'user', 'user2'] },
    { id: 'articles.list', kind: 'read', args: { limit: 'number?', offset: 'number?', tag: 'string?', author: 'string?', favorited: 'string?' }, roles: ['anonymous', 'user', 'user2'] },
    { id: 'articles.feed', kind: 'read', args: { limit: 'number?', offset: 'number?' }, roles: ['user', 'user2'] },
    { id: 'articles.get', kind: 'read', args: { slug: 'string' }, roles: ['anonymous', 'user', 'user2'] },
    { id: 'articles.create', kind: 'write', args: { title: 'string', description: 'string', body: 'string', tagList: 'array?' }, roles: ['user', 'user2'] },
    { id: 'articles.update', kind: 'write', args: { slug: 'string', title: 'string?', description: 'string?', body: 'string?' }, roles: ['user', 'user2'] },
    { id: 'articles.delete', kind: 'write', args: { slug: 'string' }, roles: ['user', 'user2'] },
    { id: 'articles.favorite', kind: 'write', args: { slug: 'string' }, roles: ['user', 'user2'] },
    { id: 'articles.unfavorite', kind: 'write', args: { slug: 'string' }, roles: ['user', 'user2'] },
    { id: 'comments.list', kind: 'read', args: { slug: 'string' }, roles: ['anonymous', 'user', 'user2'] },
    { id: 'comments.create', kind: 'write', args: { slug: 'string', body: 'string' }, roles: ['user', 'user2'] },
    { id: 'comments.delete', kind: 'write', args: { slug: 'string', id: 'number' }, roles: ['user', 'user2'] },
  ];
  return {
    manifest() {
      return {
        adapter: 'realworld',
        adapter_version: '1.0.0',
        reset_strategy: 'identity',
        canonical_view: 'agent-web/canonical-view-1',
        description: 'RealWorld 契约（19 个端点）：一份案例可以在 990+ 个实现上重跑',
        scopes: ['articles', 'tags', 'comments'],
        events_scope: 'none',
        view: {
          version: 'agent-web/view/1',
          collections: {
            articles: { kind: 'list', required: ['slug', 'title', 'author'], semantics: '文章（契约里最核心的实体）' },
            tags: { kind: 'list', required: ['name'], semantics: '标签' },
            comments: { kind: 'list', required: ['id', 'body'], semantics: '评论（按文章 slug 关联）' },
          },
        },
        roles: ['anonymous', 'user', 'user2'],
        events_complete: false,
        events_types: [],
        reset_note: 'RealWorld 没有复位接口：每次运行注册两个全新用户并删掉自己造过的文章；账号是运行级的，故意不进规范视图（否则每次复位视图都不同）',
        capabilities: capabilityBase.map((c) => ({ evidence_level: 'validated', ...c })),
      };
    },
    async reset() {
      // 夹具模式：这个内存后端有 /_fixture/reset，直接清干净（真后端没有，走下面的收尾逻辑）。
      if (process.env.REALWORLD_FIXTURE_RESET !== '0') {
        const ping = await http('POST', '/_fixture/reset', {});
        if (ping.status === 200 && ping.payload && ping.payload.reset) {
          // 清完继续走注册流程
        }
      }
      // 这个契约没有复位接口，但「复位不干净」会让判决之间互相污染。
      // 能做的是把本适配器自己造过的东西收干净：逐个旧账号列出它的文章并删掉。
      for (const past of history) {
        const list = await http('GET', `/articles?author=${encodeURIComponent(past.username)}&limit=100`, { token: past.token });
        const items = (list.payload && list.payload.articles) || [];
        for (const it of items) {
          await http('DELETE', `/articles/${encodeURIComponent(it.slug)}`, { token: past.token });
        }
      }
      runSeq += 1;
      const runId = `${Date.now().toString(36)}${runSeq}`;
      const a = { username: NAME(runId, 'a'), email: `${NAME(runId, 'a')}@test.local`, password: PASSWORD };
      const b = { username: NAME(runId, 'b'), email: `${NAME(runId, 'b')}@test.local`, password: PASSWORD };
      const ra = await http('POST', '/users', { body: { user: a } });
      const rb = await http('POST', '/users', { body: { user: b } });
      if (ra.status >= 400 || rb.status >= 400) {
        const why = (ra.payload && ra.payload.errors) || (rb.payload && rb.payload.errors) || '注册失败';
        throw new Error(`realworld 复位失败：${JSON.stringify(why)}`);
      }
      runs.set(runId, {
        users: { user: a, user2: b },
        tokens: { user: ra.payload.user.token, user2: rb.payload.user.token },
      });
      history.push({ username: a.username, token: ra.payload.user.token });
      history.push({ username: b.username, token: rb.payload.user.token });
      return {
        runId,
        state: { baseUrl: BASE() },
        // 角色 → 身份必须是**可比较的字符串**（运行器用它查角色单射）。
        roleBindings: { anonymous: null, user: a.username, user2: b.username },
        reset_note: '注册了两个新用户；服务端没有复位接口，articles 会累积',
      };
    },
    async observe(runId) {
      const run = runs.get(runId);
      const missingScopes = [];
      const view = { articles: [], tags: [], comments: [] };
      const arts = await http('GET', '/articles?limit=20');
      if (arts.status === 200 && arts.payload) {
        view.articles = (arts.payload.articles || []).map((x) => ({
          slug: x.slug, title: x.title, description: x.description, body: x.body,
          author: x.author && x.author.username, favoritesCount: x.favoritesCount, tagList: x.tagList,
        }));
      } else missingScopes.push('articles');
      const tags = await http('GET', '/tags');
      if (tags.status === 200 && tags.payload) view.tags = (tags.payload.tags || []).map((name) => ({ name }));
      else missingScopes.push('tags');
      return { state: view, missingScopes };
    },
    async execute(runId, action) {
      const run = runs.get(runId);
      const token = run && action.as ? run.tokens[action.as] : null;
      const id = action.capability;
      const a = action.arguments || {};
      const q = (obj) => {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) p.set(k, String(v));
        const s = p.toString();
        return s ? `?${s}` : '';
      };
      const call = (method, path, body) => http(method, path, { token, body });
      let res;
      switch (id) {
        case 'users.create':
          res = await call('POST', '/users', { user: { username: a.username, email: a.email, password: a.password } });
          if (res.status < 400 && res.payload && res.payload.user) {
            // 案例注册的这个人，后续步骤就以他的身份执行（run.tokens 是运行级的角色→token 表）
            run.tokens[action.as] = res.payload.user.token;
          }
          return this.classify(res, { token: res.payload && res.payload.user && res.payload.user.token });
        case 'users.login':
          res = await call('POST', '/users/login', { user: { email: a.email, password: a.password } });
          if (res.status < 400 && res.payload && res.payload.user) {
            run.tokens[action.as] = res.payload.user.token;
          }
          return this.classify(res, { token: res.payload && res.payload.user && res.payload.user.token });
        case 'user.get':
          return this.classify(await call('GET', '/user'));
        case 'user.update': {
          const user = {};
          for (const k of ['username', 'bio', 'image', 'email', 'password']) if (a[k] !== undefined) user[k] = a[k];
          return this.classify(await call('PUT', '/user', { user }));
        }
        case 'profiles.get':
          return this.classify(await call('GET', `/profiles/${encodeURIComponent(a.username)}`));
        case 'profiles.follow':
          return this.classify(await call('POST', `/profiles/${encodeURIComponent(a.username)}/follow`));
        case 'profiles.unfollow':
          return this.classify(await call('DELETE', `/profiles/${encodeURIComponent(a.username)}/follow`));
        case 'tags.list':
          return this.classify(await call('GET', '/tags'));
        case 'articles.list':
          return this.classify(await call('GET', `/articles${q({ limit: a.limit, offset: a.offset, tag: a.tag, author: a.author, favorited: a.favorited })}`));
        case 'articles.feed':
          return this.classify(await call('GET', `/articles/feed${q({ limit: a.limit, offset: a.offset })}`));
        case 'articles.get':
          return this.classify(await call('GET', `/articles/${encodeURIComponent(a.slug)}`));
        case 'articles.create': {
          const article = { title: a.title, description: a.description, body: a.body };
          if (a.tagList !== undefined) article.tagList = a.tagList;
          res = await call('POST', '/articles', { article });
          return this.classify(res, { slug: res.payload && res.payload.article && res.payload.article.slug });
        }
        case 'articles.update': {
          const article = {};
          for (const k of ['title', 'description', 'body']) if (a[k] !== undefined) article[k] = a[k];
          res = await call('PUT', `/articles/${encodeURIComponent(a.slug)}`, { article });
          return this.classify(res, { slug: res.payload && res.payload.article && res.payload.article.slug });
        }
        case 'articles.delete':
          return this.classify(await call('DELETE', `/articles/${encodeURIComponent(a.slug)}`));
        case 'articles.favorite':
          return this.classify(await call('POST', `/articles/${encodeURIComponent(a.slug)}/favorite`));
        case 'articles.unfavorite':
          return this.classify(await call('DELETE', `/articles/${encodeURIComponent(a.slug)}/favorite`));
        case 'comments.list':
          return this.classify(await call('GET', `/articles/${encodeURIComponent(a.slug)}/comments`));
        case 'comments.create':
          res = await call('POST', `/articles/${encodeURIComponent(a.slug)}/comments`, { comment: { body: a.body } });
          return this.classify(res, { id: res.payload && res.payload.comment && res.payload.comment.id });
        case 'comments.delete':
          return this.classify(await call('DELETE', `/articles/${encodeURIComponent(a.slug)}/comments/${encodeURIComponent(a.id)}`));
        default:
          return { outcome: 'unsupported', payload: null, error: `realworld 没有能力 ${id}` };
      }
    },
    classify(res, outputs) {
      const { status, payload } = res;
      const errors = payload && payload.errors ? payload.errors : null;
      // 运行器读的是 res.error.code / res.error.message（src/runner.mjs:264），
      // 给字符串会印成「被拒绝：undefined undefined」。
      if (status >= 500) return { outcome: 'infra_error', payload, error: { code: `http_${status}`, message: '服务端错误' } };
      if (status >= 400) {
        const message = errors
          ? Object.entries(errors).map(([k, v]) => `${k} ${[].concat(v).join(' ')}`).join('; ')
          : `http_${status}`;
        return { outcome: 'rejected', payload, error: { code: `http_${status}`, message } };
      }
      const out = { outcome: 'applied', payload };
      if (outputs) {
        const clean = {};
        for (const [k, v] of Object.entries(outputs)) if (v !== undefined && v !== null) clean[k] = v;
        if (Object.keys(clean).length > 0) out.outputs = clean;
      }
      return out;
    },
    async close() {},
  };
}

export const createAdapter = createRealWorldAdapter;
export default { createAdapter: createRealWorldAdapter };

// 一个零依赖的 RealWorld 服务端，够跑 hurl 那 13 套件里的大部分。
//
// 为什么自己写一个：这套适配器的价值在「同一份契约能在 990+ 个实现上重跑」，
// 但 CI 不能去 clone 别人的仓库。所以这里实现的是**契约本身**，不是某个实现。
// 它故意保留两处常见实现差异，好让断言真的有事可做：
//   - 列表默认 limit=20，`limit`/`offset` 真的生效
//   - 未登录访问 /articles/feed 返回 401（而不是空列表）
//
// 用法：node examples/realworld/fake-server.mjs [端口]

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] || 8299);
const ALLOW_RESET = process.argv.includes('--allow-reset');

const db = {
  users: new Map(), // email -> {username,email,password,bio,image,token}
  byName: new Map(),
  articles: new Map(), // slug -> {…}
  comments: new Map(), // id -> {id,slug,body,author}
  favorites: new Set(), // `${username}|${slug}`
  follows: new Set(), // `${follower}|${following}`
  seq: 0,
  lastStamp: 0,
};

const slugify = (title) => `${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${(db.seq += 1)}`;
const token = () => crypto.randomBytes(16).toString('hex');

// 单调递增的 ISO 时间戳：同一毫秒内连续创建也严格递增。
// 列表按 createdAt 倒序排，两个时间戳相等时 sort 是稳定的 —— 顺序就退化成插入序，
// 「翻页拿到刚建的那条」会错一页。CI 机器上两次创建落在同一毫秒是常态，不是巧合。
// REALWORLD_FIXTURE_FROZEN_MS 把「现在」钉死在某个毫秒上，用来确定性地测上面这条性质：
// 时钟不走的时候，连建三条也必须拿到三个严格递增的时间戳。不设就正常走系统时钟。
const FROZEN_MS = Number(process.env.REALWORLD_FIXTURE_FROZEN_MS || 0);

function stamp() {
  const now = FROZEN_MS > 0 ? FROZEN_MS : Date.now();
  db.lastStamp = now > db.lastStamp ? now : db.lastStamp + 1;
  return new Date(db.lastStamp).toISOString();
}

function send(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, text ? { 'content-type': 'application/json' } : {});
  res.end(text);
}
const errs = (res, status, fields) => send(res, status, { errors: fields });

function userOf(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Token\s+(.+)$/i);
  if (!m) return null;
  for (const u of db.users.values()) if (u.token === m[1]) return u;
  return null;
}

const profileOf = (u, viewer) => ({
  username: u.username,
  bio: u.bio || null,
  image: u.image || null,
  following: viewer ? db.follows.has(`${viewer.username}|${u.username}`) : false,
});

const articleOf = (a, viewer) => ({
  slug: a.slug,
  title: a.title,
  description: a.description,
  body: a.body,
  tagList: a.tagList,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  favorited: viewer ? db.favorites.has(`${viewer.username}|${a.slug}`) : false,
  favoritesCount: [...db.favorites].filter((k) => k.endsWith(`|${a.slug}`)).length,
  author: profileOf(db.byName.get(a.author), viewer),
});

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      if (!buf) return resolve(null);
      try { resolve(JSON.parse(buf)); } catch { resolve(null); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/^\/api/, '');
  const q = url.searchParams;
  const method = req.method.toUpperCase();
  const viewer = userOf(req);
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : null;
  const seg = path.split('/').filter(Boolean);

  // 夹具专用复位口：清空全部状态。**只有这个内存夹具才有**，真后端没有这个口，
  // 真后端上靠「每次用新 uid 注册」避免重复。默认关闭，要 --allow-reset 才开。
  if (method === 'POST' && path === '/_fixture/reset') {
    if (!ALLOW_RESET) return errs(res, 404, { route: ['not found'] });
    db.users.clear();
    db.byName.clear();
    db.articles.clear();
    db.comments.clear();
    db.favorites.clear();
    db.follows.clear();
    db.seq = 0;
    db.lastStamp = 0;
    return send(res, 200, { reset: true });
  }
  // POST /users
  if (method === 'POST' && path === '/users') {
    const u = body && body.user;
    if (!u || typeof u !== 'object' || Array.isArray(u)) return errs(res, 422, { body: ['is missing'] });
    const fields = {};
    for (const key of ['username', 'email', 'password']) {
      if (typeof u[key] !== 'string' || u[key].trim() === '') fields[key] = ["can't be blank"];
    }
    if (!fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) fields.email = ['is invalid'];
    if (Object.keys(fields).length) return errs(res, 422, fields);
    if (db.users.has(u.email)) return errs(res, 409, { email: ['has already been taken'] });
    if (db.byName.has(u.username)) return errs(res, 409, { username: ['has already been taken'] });
    const rec = { username: u.username, email: u.email, password: u.password, bio: null, image: null, token: token() };
    db.users.set(rec.email, rec);
    db.byName.set(rec.username, rec);
    return send(res, 201, { user: { email: rec.email, username: rec.username, bio: null, image: null, token: rec.token } });
  }
  // POST /users/login
  if (method === 'POST' && path === '/users/login') {
    const u = body && body.user;
    if (!u || typeof u !== 'object' || Array.isArray(u)) return errs(res, 422, { body: ['is missing'] });
    const fields = {};
    for (const key of ['email', 'password']) {
      if (typeof u[key] !== 'string' || u[key].trim() === '') fields[key] = ["can't be blank"];
    }
    if (!fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) fields.email = ['is invalid'];
    if (Object.keys(fields).length) return errs(res, 422, fields);
    const rec = db.users.get(u.email);
    if (!rec || rec.password !== u.password) return errs(res, 401, { credentials: ['invalid'] });
    rec.token = token();
    return send(res, 200, { user: { email: rec.email, username: rec.username, bio: rec.bio, image: rec.image, token: rec.token } });
  }
  // GET/PUT /user
  if (path === '/user') {
    if (!viewer) return errs(res, 401, { token: ['is missing'] });
    if (method === 'GET') return send(res, 200, { user: { email: viewer.email, username: viewer.username, bio: viewer.bio, image: viewer.image, token: viewer.token } });
    if (method === 'PUT') {
      const u = (body && body.user) || {};
      const fields = {};
      if (u.username !== undefined) {
        if (typeof u.username !== 'string' || u.username.trim() === '') fields.username = ["can't be blank"];
        else if (u.username !== viewer.username && db.byName.has(u.username)) fields.username = ['has already been taken'];
      }
      if (u.email !== undefined) {
        if (typeof u.email !== 'string' || u.email.trim() === '') fields.email = ["can't be blank"];
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) fields.email = ['is invalid'];
        else if (u.email !== viewer.email && db.users.has(u.email)) fields.email = ['has already been taken'];
      }
      if (u.password !== undefined) {
        if (typeof u.password !== 'string' || u.password === '') fields.password = ["can't be blank"];
        else if (u.password.length < 8) fields.password = ['is too short'];
      }
      if (Object.keys(fields).length) return errs(res, 422, fields);

      // RealWorld 的约定：空字符串等于清空、返回 null（不是 ""）。
      if (u.username !== undefined && u.username !== viewer.username) {
        db.byName.delete(viewer.username);
        viewer.username = u.username;
        db.byName.set(u.username, viewer);
      }
      if (u.email !== undefined && u.email !== viewer.email) {
        db.users.delete(viewer.email);
        viewer.email = u.email;
        db.users.set(u.email, viewer);
      }
      if (u.password !== undefined) viewer.password = u.password;
      if (u.bio !== undefined) viewer.bio = u.bio === '' ? null : u.bio;
      if (u.image !== undefined) viewer.image = u.image === '' ? null : u.image;
      return send(res, 200, { user: { email: viewer.email, username: viewer.username, bio: viewer.bio, image: viewer.image, token: viewer.token } });
    }
  }
  // /profiles/:username[/follow]
  if (seg[0] === 'profiles' && seg[1]) {
    if (seg[2] === 'follow' && ['POST', 'DELETE'].includes(method) && !viewer) {
      return errs(res, 401, { token: ['is missing'] });
    }
    const target = db.byName.get(decodeURIComponent(seg[1]));
    if (!target) return errs(res, 404, { profile: ['not found'] });
    if (seg[2] === 'follow' && method === 'POST') {
      if (!viewer) return errs(res, 401, { profile: ['is not authenticated'] });
      db.follows.add(`${viewer.username}|${target.username}`);
      return send(res, 200, { profile: profileOf(target, viewer) });
    }
    if (seg[2] === 'follow' && method === 'DELETE') {
      if (!viewer) return errs(res, 401, { profile: ['is not authenticated'] });
      db.follows.delete(`${viewer.username}|${target.username}`);
      return send(res, 200, { profile: profileOf(target, viewer) });
    }
    if (method === 'GET') return send(res, 200, { profile: profileOf(target, viewer) });
  }
  // GET /tags
  if (method === 'GET' && path === '/tags') {
    const set = new Set();
    for (const a of db.articles.values()) for (const t of a.tagList) set.add(t);
    return send(res, 200, { tags: [...set].sort() });
  }
  // GET /articles/feed
  if (method === 'GET' && path === '/articles/feed') {
    if (!viewer) return errs(res, 401, { token: ['is missing'] });
    const mine = [...db.articles.values()]
      .filter((a) => db.follows.has(`${viewer.username}|${a.author}`))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const limit = Math.min(Number(q.get('limit') || 20), 100);
    const offset = Number(q.get('offset') || 0);
    const page = mine.slice(offset, offset + limit);
    return send(res, 200, { articles: page.map((a) => articleOf(a, viewer)), articlesCount: mine.length });
  }
  // GET /articles
  if (method === 'GET' && path === '/articles') {
    // 契约约定：列表按创建时间**倒序**（最新的在前）。写成插入序会让「翻页找到刚建的那条」永远错一页。
    let list = [...db.articles.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (q.get('author')) list = list.filter((a) => a.author === q.get('author'));
    if (q.get('tag')) list = list.filter((a) => a.tagList.includes(q.get('tag')));
    if (q.get('favorited')) {
      const who = q.get('favorited');
      list = list.filter((a) => db.favorites.has(`${who}|${a.slug}`));
    }
    const limit = Math.min(Number(q.get('limit') || 20), 100);
    const offset = Number(q.get('offset') || 0);
    const page = list.slice(offset, offset + limit);
    return send(res, 200, { articles: page.map((a) => articleOf(a, viewer)), articlesCount: list.length });
  }
  // POST /articles
  if (method === 'POST' && path === '/articles') {
    if (!viewer) return errs(res, 401, { token: ['is missing'] });
    const a = (body && body.article) || {};
    const missing = ['title', 'description', 'body'].filter((k) => !a[k]);
    if (missing.length) return errs(res, 422, Object.fromEntries(missing.map((k) => [k, ["can't be blank"]])));
    const now = stamp();
    const rec = {
      slug: slugify(a.title), title: a.title, description: a.description, body: a.body,
      tagList: Array.isArray(a.tagList) ? a.tagList : [], author: viewer.username, createdAt: now, updatedAt: now,
    };
    db.articles.set(rec.slug, rec);
    return send(res, 201, { article: articleOf(rec, viewer) });
  }
  // /articles/:slug[/comments|/favorite]
  if (seg[0] === 'articles' && seg[1]) {
    const slug = decodeURIComponent(seg[1]);
    const art = db.articles.get(slug);
    if (seg.length === 2 && ['PUT', 'DELETE'].includes(method) && !viewer) {
      return errs(res, 401, { token: ['is missing'] });
    }
    if (seg[2] === 'comments') {
      if (method === 'GET') {
        if (!art) return errs(res, 404, { article: ['not found'] });
        const list = [...db.comments.values()].filter((c) => c.slug === slug);
        return send(res, 200, { comments: list.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: profileOf(db.byName.get(c.author), viewer) })) });
      }
      if (method === 'POST') {
        if (!viewer) return errs(res, 401, { token: ['is missing'] });
        if (!art) return errs(res, 404, { article: ['not found'] });
        const b = body && body.comment && body.comment.body;
        if (!b) return errs(res, 422, { body: ["can't be blank"] });
        const id = (db.seq += 1);
        const rec = { id, slug, body: b, author: viewer.username, createdAt: stamp() };
        db.comments.set(id, rec);
        return send(res, 201, { comment: { id, body: b, createdAt: rec.createdAt, author: profileOf(viewer, viewer) } });
      }
      if (method === 'DELETE' && seg[3]) {
        if (!viewer) return errs(res, 401, { token: ['is missing'] });
        if (!art) return errs(res, 404, { article: ['not found'] });
        const rec = db.comments.get(Number(seg[3]));
        if (!rec) return errs(res, 404, { comment: ['not found'] });
        if (rec.author !== viewer.username) return errs(res, 403, { comment: ['forbidden'] });
        db.comments.delete(rec.id);
        res.writeHead(200); return res.end();
      }
    }
    if (seg[2] === 'favorite') {
      if (!viewer) return errs(res, 401, { token: ['is missing'] });
      if (!art) return errs(res, 404, { article: ['not found'] });
      if (method === 'POST') db.favorites.add(`${viewer.username}|${slug}`);
      if (method === 'DELETE') db.favorites.delete(`${viewer.username}|${slug}`);
      return send(res, 200, { article: articleOf(art, viewer) });
    }
    if (!art) return errs(res, 404, { article: ['not found'] });
    if (method === 'GET') return send(res, 200, { article: articleOf(art, viewer) });
    if (method === 'PUT') {
      if (!viewer) return errs(res, 401, { token: ['is missing'] });
      if (art.author !== viewer.username) return errs(res, 403, { article: ['forbidden'] });
      const a = (body && body.article) || {};
      if (a.tagList !== undefined && !Array.isArray(a.tagList)) return errs(res, 422, { tagList: ['is invalid'] });
      for (const k of ['title', 'description', 'body', 'tagList']) if (a[k] !== undefined) art[k] = a[k];
      art.updatedAt = stamp();
      return send(res, 200, { article: articleOf(art, viewer) });
    }
    if (method === 'DELETE') {
      if (!viewer) return errs(res, 401, { token: ['is missing'] });
      if (art.author !== viewer.username) return errs(res, 403, { article: ['forbidden'] });
      db.articles.delete(slug);
      res.writeHead(200); return res.end();
    }
  }
  errs(res, 404, { route: [`${method} ${path} not found`] });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake realworld on http://127.0.0.1:${PORT}  (in-memory, 19 endpoints)`);
});

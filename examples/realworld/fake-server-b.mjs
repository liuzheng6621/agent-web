// 同一份 RealWorld 契约的**第二个实现**。它存在的唯一目的，是让
// `compare cases/realworld --adapters=realworld,realworld-b` 有意义。
//
// 为什么不能拿「第二个适配器」凑数：适配器只是同一份实现的另一个入口，
// 自己跟自己比判决必然一致，什么也证明不了。域的门槛要的是两份**独立实现**。
//
// 所以这里刻意换掉全部内部结构，只保留契约：
//   - 存储用数组 + 下标，不用 Map；文章表天然「最新在前」（unshift），不每次排序
//   - slug 生成规则不同（`词1.词2.<seq36>` 而不是 `<title-kebab>-<seq>`）
//   - favoritesCount / following 用增量计数器，不再每次扫全表
//   - createdAt 用单调时钟，同一毫秒内连续创建也保证严格递增（排序才稳定）
//   - 校验改成表驱动，错误字段与文案仍与契约一致
//
// 用法：node examples/realworld/fake-server-b.mjs [端口] [--allow-reset]

import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] || 8298);
const ALLOW_RESET = process.argv.includes('--allow-reset');

// 故意留的「已知故障」开关。它不是为了模拟谁，是为了**证明对照能看见故障**：
// 把 B 弄坏再跑 `compare`，判决必须不一致；一直一致就说明案例在睡觉。
// 用法：REALWORLD_B_BUG=order|count|owner
const BUG = process.env.REALWORLD_B_BUG || '';

// 数组存储。userId 是下标；articleId 是下标，slugs 负责 slug → 下标。
const db = {
  users: [],
  userIdByEmail: new Map(),
  userIdByName: new Map(),
  articles: [], // 最新在前
  slugToId: new Map(),
  comments: [],
  favs: new Map(), // articleId -> Set(username)
  follows: new Map(), // follower -> Set(following)
  seq: 0,
  lastStamp: 0,
};

const id36 = (n) => n.toString(36);
const makeToken = () => crypto.randomBytes(12).toString('base64url');

// 单调递增的 ISO 时间戳：同一毫秒内连续创建也严格递增，否则排序不稳定，
// 「按创建时间倒序」在两份实现上会给出不同顺序 —— 那是实现差异，不是契约差异。
function stamp() {
  const now = Date.now();
  db.lastStamp = now > db.lastStamp ? now : db.lastStamp + 1;
  return new Date(db.lastStamp).toISOString();
}

function slugFor(title) {
  db.seq += 1;
  const words = String(title).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 3);
  return `${words.join('.') || 'post'}.${id36(db.seq)}`;
}

function send(res, status, body) {
  if (body === undefined) { res.writeHead(status); res.end(); return; }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}
const errs = (res, status, fields) => send(res, status, { errors: fields });

function viewerOf(req) {
  const raw = String(req.headers.authorization || '');
  const m = raw.match(/^Token\s+(.+)$/i);
  if (!m) return null;
  return db.users.find((u) => u.token === m[1]) || null;
}

const following = (a, b) => db.follows.get(a)?.has(b) === true;

function profile(u, viewer) {
  return {
    username: u.username,
    bio: u.bio ?? null,
    image: u.image ?? null,
    following: viewer ? following(viewer.username, u.username) : false,
  };
}

function articleView(a, viewer) {
  const favSet = db.favs.get(a.id);
  return {
    slug: a.slug,
    title: a.title,
    description: a.description,
    body: a.body,
    tagList: a.tagList.slice(),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    favorited: viewer ? favSet?.has(viewer.username) === true : false,
    favoritesCount: BUG === 'count' ? 0 : favSet ? favSet.size : 0,
    author: profile(db.users[db.userIdByName.get(a.author)], viewer),
  };
}

function bodyOf(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve(null);
      try { resolve(JSON.parse(text)); } catch { resolve(null); }
    });
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank = (v) => typeof v !== 'string' || v.trim() === '';

// 表驱动校验：每项 [字段, 判定, 错误文案]
const USER_RULES = [
  ['username', (v) => blank(v), "can't be blank"],
  ['email', (v) => blank(v), "can't be blank"],
  ['password', (v) => blank(v), "can't be blank"],
  ['email', (v) => !blank(v) && !EMAIL_RE.test(v), 'is invalid'],
];

function validateUser(u, extra = []) {
  const fields = {};
  for (const [key, bad, msg] of [...USER_RULES, ...extra]) {
    if (fields[key]) continue;
    if (bad(u[key])) fields[key] = [msg];
  }
  return fields;
}

function page(list, q) {
  const limit = Math.min(Number(q.get('limit') || 20), 100);
  const offset = Number(q.get('offset') || 0);
  return { slice: list.slice(offset, offset + limit), total: list.length };
}

function commentView(c) {
  const uid = db.userIdByName.get(c.author);
  return {
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    author: profile(uid === undefined ? { username: c.author, bio: null, image: null } : db.users[uid], null),
  };
}

function findArticle(slug) {
  const id = db.slugToId.get(slug);
  return id === undefined ? null : db.articles.find((a) => a.id === id) || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/^\/api/, '');
  const q = url.searchParams;
  const method = req.method.toUpperCase();
  const viewer = viewerOf(req);
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await bodyOf(req) : null;
  const seg = path.split('/').filter(Boolean);

  if (method === 'POST' && path === '/_fixture/reset') {
    if (!ALLOW_RESET) return errs(res, 404, { route: ['not found'] });
    db.users.length = 0;
    db.userIdByEmail.clear();
    db.userIdByName.clear();
    db.articles.length = 0;
    db.slugToId.clear();
    db.comments.length = 0;
    db.favs.clear();
    db.follows.clear();
    db.seq = 0;
    db.lastStamp = 0;
    return send(res, 200, { reset: true });
  }

  // —— 注册 ——
  if (method === 'POST' && path === '/users') {
    const u = body && body.user;
    if (!u || typeof u !== 'object' || Array.isArray(u)) return errs(res, 422, { body: ['is missing'] });
    // 契约的判定顺序是可观测的：**先格式后唯一性**。格式错一律 422，即便同时撞了唯一性；
    // 反过来（先报 409）会让「空密码 + 重名」这类输入在两份实现上给出不同状态码。
    const format = validateUser(u);
    if (Object.keys(format).length) return errs(res, 422, format);
    const conflict = {};
    if (db.userIdByEmail.has(u.email)) conflict.email = ['has already been taken'];
    if (db.userIdByName.has(u.username)) conflict.username = ['has already been taken'];
    if (Object.keys(conflict).length) return errs(res, 409, conflict);
    const rec = { username: u.username, email: u.email, password: u.password, bio: null, image: null, token: makeToken() };
    const id = db.users.push(rec) - 1;
    db.userIdByEmail.set(rec.email, id);
    db.userIdByName.set(rec.username, id);
    return send(res, 201, { user: { email: rec.email, username: rec.username, bio: null, image: null, token: rec.token } });
  }

  // —— 登录 ——
  if (method === 'POST' && path === '/users/login') {
    const u = body && body.user;
    if (!u || typeof u !== 'object' || Array.isArray(u)) return errs(res, 422, { body: ['is missing'] });
    const fields = validateUser({ ...u, username: 'ok' });
    delete fields.username;
    if (Object.keys(fields).length) return errs(res, 422, fields);
    const id = db.userIdByEmail.get(u.email);
    const rec = id === undefined ? null : db.users[id];
    if (!rec || rec.password !== u.password) return errs(res, 401, { credentials: ['invalid'] });
    rec.token = makeToken();
    return send(res, 200, { user: { email: rec.email, username: rec.username, bio: rec.bio, image: rec.image, token: rec.token } });
  }

  // —— 当前用户 ——
  if (path === '/user') {
    if (!viewer) return errs(res, 401, { token: ['is missing'] });
    if (method === 'GET') {
      return send(res, 200, { user: { email: viewer.email, username: viewer.username, bio: viewer.bio, image: viewer.image, token: viewer.token } });
    }
    if (method === 'PUT') {
      const u = (body && body.user) || {};
      const fields = {};
      for (const key of ['username', 'email', 'password']) {
        if (u[key] === undefined) continue;
        if (blank(u[key])) { fields[key] = ["can't be blank"]; continue; }
        if (key === 'email' && !EMAIL_RE.test(u.email)) { fields.email = ['is invalid']; continue; }
        if (key === 'password' && u.password.length < 8) { fields.password = ['is too short']; continue; }
        if (key === 'username' && u.username !== viewer.username && db.userIdByName.has(u.username)) { fields.username = ['has already been taken']; continue; }
        if (key === 'email' && u.email !== viewer.email && db.userIdByEmail.has(u.email)) fields.email = ['has already been taken'];
      }
      if (Object.keys(fields).length) return errs(res, 422, fields);

      if (u.username !== undefined && u.username !== viewer.username) {
        const uid = db.userIdByName.get(viewer.username) ?? db.users.indexOf(viewer);
        db.userIdByName.delete(viewer.username);
        viewer.username = u.username;
        db.userIdByName.set(u.username, uid);
      }
      if (u.email !== undefined && u.email !== viewer.email) {
        db.userIdByEmail.delete(viewer.email);
        db.userIdByEmail.set(u.email, db.users.indexOf(viewer));
        viewer.email = u.email;
      }
      if (u.password !== undefined) viewer.password = u.password;
      if (u.bio !== undefined) viewer.bio = u.bio === '' ? null : u.bio;
      if (u.image !== undefined) viewer.image = u.image === '' ? null : u.image;
      return send(res, 200, { user: { email: viewer.email, username: viewer.username, bio: viewer.bio, image: viewer.image, token: viewer.token } });
    }
  }

  // —— profile ——
  if (seg[0] === 'profiles' && seg[1]) {
    const name = decodeURIComponent(seg[1]);
    if (seg[2] === 'follow' && ['POST', 'DELETE'].includes(method) && !viewer) {
      return errs(res, 401, { token: ['is missing'] });
    }
    const uid = db.userIdByName.get(name);
    if (uid === undefined) return errs(res, 404, { profile: ['not found'] });
    const target = db.users[uid];
    if (seg[2] === 'follow' && ['POST', 'DELETE'].includes(method)) {
      if (!viewer) return errs(res, 401, { profile: ['is not authenticated'] });
      const set = db.follows.get(viewer.username) || new Set();
      if (method === 'POST') set.add(target.username); else set.delete(target.username);
      db.follows.set(viewer.username, set);
      return send(res, 200, { profile: profile(target, viewer) });
    }
    if (method === 'GET') return send(res, 200, { profile: profile(target, viewer) });
  }

  // —— tags ——
  if (method === 'GET' && path === '/tags') {
    const set = new Set();
    for (const a of db.articles) for (const t of a.tagList) set.add(t);
    return send(res, 200, { tags: [...set].sort() });
  }

  // —— feed ——
  if (method === 'GET' && path === '/articles/feed') {
    if (!viewer) return errs(res, 401, { token: ['is missing'] });
    const mine = db.articles.filter((a) => following(viewer.username, a.author));
    const { slice, total } = page(mine, q);
    return send(res, 200, { articles: slice.map((a) => articleView(a, viewer)), articlesCount: total });
  }

  // —— 文章列表 ——
  if (method === 'GET' && path === '/articles') {
    // db.articles 天然最新在前（unshift），不用每次排序。
    let list = BUG === 'order' ? db.articles.slice().reverse() : db.articles;
    const author = q.get('author');
    const tag = q.get('tag');
    const favBy = q.get('favorited');
    if (author) list = list.filter((a) => a.author === author);
    if (tag) list = list.filter((a) => a.tagList.includes(tag));
    if (favBy) list = list.filter((a) => db.favs.get(a.id)?.has(favBy) === true);
    const { slice, total } = page(list, q);
    return send(res, 200, { articles: slice.map((a) => articleView(a, viewer)), articlesCount: total });
  }

  // —— 建文章 ——
  if (method === 'POST' && path === '/articles') {
    if (!viewer) return errs(res, 401, { token: ['is missing'] });
    const a = (body && body.article) || {};
    const missing = ['title', 'description', 'body'].filter((k) => !a[k]);
    if (missing.length) return errs(res, 422, Object.fromEntries(missing.map((k) => [k, ["can't be blank"]])));
    const now = stamp();
    const rec = {
      id: (db.seq += 1),
      slug: slugFor(a.title),
      title: a.title,
      description: a.description,
      body: a.body,
      tagList: Array.isArray(a.tagList) ? a.tagList.slice() : [],
      author: viewer.username,
      createdAt: now,
      updatedAt: now,
    };
    db.articles.unshift(rec);
    db.slugToId.set(rec.slug, rec.id);
    return send(res, 201, { article: articleView(rec, viewer) });
  }

  // —— 文章详情 / 修改 / 删除 / 评论 / 收藏 ——
  if (seg[0] === 'articles' && seg[1]) {
    const slug = decodeURIComponent(seg[1]);
    const art = findArticle(slug);
    if (seg.length === 2 && ['PUT', 'DELETE'].includes(method) && !viewer) {
      return errs(res, 401, { token: ['is missing'] });
    }
    if (seg[2] === 'comments') {
      if (method === 'GET') {
        if (!art) return errs(res, 404, { article: ['not found'] });
        const list = db.comments.filter((c) => c.slug === slug);
        return send(res, 200, { comments: list.map(commentView) });
      }
      if (method === 'POST') {
        if (!viewer) return errs(res, 401, { token: ['is missing'] });
        if (!art) return errs(res, 404, { article: ['not found'] });
        const text = body && body.comment && body.comment.body;
        if (!text) return errs(res, 422, { body: ["can't be blank"] });
        db.seq += 1;
        const rec = { id: db.seq, slug, body: text, author: viewer.username, createdAt: stamp() };
        db.comments.push(rec);
        return send(res, 201, { comment: commentView(rec) });
      }
      if (method === 'DELETE' && seg[3]) {
        if (!viewer) return errs(res, 401, { token: ['is missing'] });
        if (!art) return errs(res, 404, { article: ['not found'] });
        const idx = db.comments.findIndex((c) => c.id === Number(seg[3]));
        if (idx < 0) return errs(res, 404, { comment: ['not found'] });
        const rec = db.comments[idx];
        if (rec.author !== viewer.username) return errs(res, 403, { comment: ['forbidden'] });
        db.comments.splice(idx, 1);
        return send(res, 200);
      }
    }
    if (seg[2] === 'favorite') {
      if (!viewer) return errs(res, 401, { token: ['is missing'] });
      if (!art) return errs(res, 404, { article: ['not found'] });
      const set = db.favs.get(art.id) || new Set();
      if (method === 'POST') set.add(viewer.username); else set.delete(viewer.username);
      db.favs.set(art.id, set);
      return send(res, 200, { article: articleView(art, viewer) });
    }
    if (!art) return errs(res, 404, { article: ['not found'] });
    if (method === 'GET') return send(res, 200, { article: articleView(art, viewer) });
    if (method === 'PUT') {
      if (BUG !== 'owner' && art.author !== viewer.username) return errs(res, 403, { article: ['forbidden'] });
      const a = (body && body.article) || {};
      if (a.tagList !== undefined && !Array.isArray(a.tagList)) return errs(res, 422, { tagList: ['is invalid'] });
      for (const k of ['title', 'description', 'body', 'tagList']) {
        if (a[k] === undefined) continue;
        art[k] = k === 'tagList' ? a[k].slice() : a[k];
      }
      art.updatedAt = stamp();
      return send(res, 200, { article: articleView(art, viewer) });
    }
    if (method === 'DELETE') {
      if (BUG !== 'owner' && art.author !== viewer.username) return errs(res, 403, { article: ['forbidden'] });
      db.articles = db.articles.filter((a) => a.id !== art.id);
      db.slugToId.delete(slug);
      db.comments = db.comments.filter((c) => c.slug !== slug);
      db.favs.delete(art.id);
      return send(res, 200);
    }
  }

  errs(res, 404, { route: [`${method} ${path} not found`] });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake realworld (impl B) on http://127.0.0.1:${PORT}  (array-backed, 19 endpoints)`);
});

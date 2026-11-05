/**
 * 夹具应用：一个带鉴权、带错误码、带复位接口的 todo 小后台。
 *
 * 它的唯一用途是当「从没接过的第三方应用」：验收 tap → learn → decl → twin
 * 这条链时，不能拿咖啡店（我们自己写的适配器）当陌生人。
 * 零依赖，node 直接跑：node examples/todo-app/server.mjs 8199
 *
 * TODO_APP_BUG=1 时第二条 create 假成功不落库——用来验收「改坏真实应用必须红」。
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.argv[2] || 8199);
const BUG = process.env.TODO_APP_BUG === '1';

const USERS = {
  admin: { password: 'admin123', role: 'admin', score: 0 },
  dev: { password: 'dev123', role: 'member', score: 0 },
};
let tasks = new Map();
let nextId = 1;
const tokens = new Map();

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function who(req) {
  const h = req.headers.authorization || '';
  const t = h.replace(/^Bearer\s+/i, '');
  return tokens.get(t) || null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  const body = await readBody(req);

  if (req.method === 'POST' && path === '/login') {
    const u = USERS[body.username];
    if (!u || u.password !== body.password) return json(res, 401, { code: 40101, message: '用户名或密码错' });
    const token = crypto.randomBytes(8).toString('hex');
    tokens.set(token, { username: body.username, role: u.role });
    return json(res, 200, { token, role: u.role });
  }

  if (req.method === 'POST' && path === '/api/reset') {
    const me = who(req);
    if (!me) return json(res, 401, { code: 40101, message: '没带 token' });
    if (me.role !== 'admin') return json(res, 403, { code: 40301, message: '只有 admin 能复位' });
    tasks = new Map();
    nextId = 1;
    for (const u of Object.values(USERS)) u.score = 0;
    return json(res, 200, { ok: true });
  }

  const me = who(req);
  if (!me) return json(res, 401, { code: 40101, message: '没带 token' });

  if (req.method === 'GET' && path === '/api/tasks') {
    return json(res, 200, { items: [...tasks.values()].map((t) => ({ ...t })) });
  }
  if (req.method === 'GET' && path === '/api/users') {
    return json(res, 200, { items: Object.entries(USERS).map(([username, u]) => ({ username, role: u.role, score: u.score })) });
  }
  if (req.method === 'POST' && path === '/api/tasks') {
    if (typeof body.title !== 'string' || body.title === '') return json(res, 400, { code: 40001, message: 'title 必填' });
    const points = Number.isFinite(Number(body.points)) ? Math.round(Number(body.points)) : 1;
    const task = { id: nextId, title: body.title, done: false, points, owner: me.username };
    // BUG 模式：第二条 create 返回 201 但不落库——一个 count_delta 就抓得住的回归。
    if (BUG && tasks.size >= 2) {
      nextId += 1;
      return json(res, 201, { ...task });
    }
    tasks.set(nextId, task);
    nextId += 1;
    return json(res, 201, { ...task });
  }
  const complete = path.match(/^\/api\/tasks\/(\d+)\/complete$/);
  if (req.method === 'POST' && complete) {
    const t = tasks.get(Number(complete[1]));
    if (!t) return json(res, 404, { code: 40401, message: '任务不存在' });
    if (t.done) return json(res, 409, { code: 40901, message: '已经完成过了' });
    if (!(me.role === 'admin' || t.owner === me.username)) return json(res, 403, { code: 40301, message: '不是你的任务' });
    t.done = true;
    if (!BUG) USERS[t.owner].score += t.points;
    return json(res, 200, { ...t });
  }
  const del = path.match(/^\/api\/tasks\/(\d+)$/);
  if (req.method === 'DELETE' && del) {
    if (me.role !== 'admin') return json(res, 403, { code: 40301, message: '只有 admin 能删' });
    const id = Number(del[1]);
    if (!tasks.has(id)) return json(res, 404, { code: 40401, message: '任务不存在' });
    tasks.delete(id);
    return json(res, 200, { ok: true, id });
  }
  return json(res, 404, { code: 40400, message: '没有这个接口' });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`todo-app listening on http://127.0.0.1:${PORT}${BUG ? ' (BUG MODE)' : ''}\n`);
});

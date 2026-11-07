// 咖啡店域的第二条观测通道（三层验证栈 L2 写后事实层的地基）。
//
// 命题：HTTP 观测视图 == 数据库真实状态投影。execute 与 HTTP 适配器完全同源
//（直接复用 createTaixianglianAdapter），唯一变量是 observe —— 不再信后端
// 给的 JSON，而是外部进程经 AUTO_SERVER 直读 H2 文件库，把表行映射成同一
// 份 canonical view。compare 两通道判决一致，写后事实层才成立。
//
// 观测通道实现：常驻 H2 Shell 子进程（stdin 发 SQL，stdout 收结果表），
// 30 秒空闲自动退出，下一条查询自动重启 —— 适配器不泄漏进程。
// 编码：-Dstdout.encoding=UTF-8 保证中文列值完好。

import { spawn } from 'node:child_process';
import { createTaixianglianAdapter, TAIXIANGLIAN_MANIFEST } from './taixianglian.mjs';
import { validateManifest } from './contract.mjs';

const SQL_DEFAULTS = {
  // dbUrl / h2Jar 是本机 fixture 事实，不写死进仓库：env 或 options 显式给。
  // dbUrl 必须带 AUTO_SERVER=TRUE（后端活着时外部才能混连）。
  dbUrl: process.env.TAIXIANGLIAN_SQL_DB_URL || '',
  javaBin: process.env.TAIXIANGLIAN_SQL_JAVA || 'java',
  h2Jar: process.env.TAIXIANGLIAN_SQL_H2_JAR || '',
  queryTimeoutMs: 8000,
  idleQuitMs: 30000,
};

/** 常驻 H2 Shell 会话。串行问答：写一条 SQL，等提示符回来，解析一段输出。 */
class H2Shell {
  constructor(opt) {
    this.opt = opt;
    this.proc = null;
    this.buf = '';
    this.pending = null;
    this.error = null;
    this.idleTimer = null;
  }

  #ingest(d) {
    this.buf += d.toString('utf8');
    if (this.pending && this.buf.endsWith('sql> ')) {
      const r = this.pending;
      this.pending = null;
      r();
    }
  }

  #waitPrompt(ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending = null;
        reject(new Error(`h2 shell ${ms}ms 内没有回到提示符`));
      }, ms);
      this.pending = () => { clearTimeout(t); resolve(); };
    });
  }

  #armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), this.opt.idleQuitMs);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }
  async start() {
    if (!this.opt.dbUrl || !this.opt.h2Jar) {
      throw new Error('taixianglian-sql 需要显式 dbUrl 与 h2Jar（env TAIXIANGLIAN_SQL_DB_URL / TAIXIANGLIAN_SQL_H2_JAR 或 options）');
    }
    this.proc = spawn(this.opt.javaBin, [
      '-Dstdout.encoding=UTF-8', '-Dfile.encoding=UTF-8',
      '-cp', this.opt.h2Jar, 'org.h2.tools.Shell',
      '-url', this.opt.dbUrl, '-user', 'sa', '-password', '',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => this.#ingest(d));
    this.proc.stderr.on('data', (d) => { if (!this.error) this.error = String(d).trim(); });
    this.proc.on('close', (code) => {
      if (!this.error) this.error = `h2 shell 意外退出 code=${code}`;
      if (this.pending) { const p = this.pending; this.pending = null; p(); }
    });
    this.#armIdle();
    try {
      await this.#waitPrompt(this.opt.queryTimeoutMs); // banner 末尾的第一个提示符
    } catch (e) {
      throw new Error(this.error || e.message);
    }
    this.buf = '';
  }

  async query(sql) {
    if (!this.proc) await this.start();
    if (this.error) { const msg = this.error; await this.stop(); throw new Error(msg); }
    this.buf = '';
    this.#armIdle();
    this.proc.stdin.write(sql + ';\n');
    try {
      await this.#waitPrompt(this.opt.queryTimeoutMs);
    } catch (e) {
      const msg = this.error || e.message;
      await this.stop();
      throw new Error(msg);
    }
    const out = this.buf;
    this.buf = '';
    return this.#parse(out);
  }

  #parse(out) {
    const seg = out.replace(/sql> $/, '').replace(/\r\n/g, '\n').trim();
    if (seg.startsWith('Error:')) throw new Error(seg.split('\n')[0]);
    if (seg === '') return { columns: [], rows: [], rowCount: 0 };
    const lines = seg.split('\n').filter((l) => l.trim() !== '');
    const m = lines[lines.length - 1].match(/^\((\d+) rows?, /);
    if (!m) throw new Error(`h2 shell 输出无法解析：${lines[lines.length - 1]}`);
    const rowCount = Number(m[1]);
    const body = lines.slice(0, -1);
    const columns = body.length ? body[0].split('|').map((s) => s.trim()) : [];
    const rows = body.slice(1).map((line) => {
      const cells = columns.length === 1 ? [line.trim()] : line.split('|').map((s) => s.trim());
      const row = {};
      columns.forEach((c, i) => { row[c] = cells[i] === undefined || cells[i] === 'null' ? null : cells[i]; });
      return row;
    });
    return { columns, rows, rowCount };
  }

  async stop() {
    clearTimeout(this.idleTimer);
    const p = this.proc;
    this.proc = null;
    this.pending = null;
    if (!p) return;
    try { p.stdin.write('quit;\n'); p.stdin.end(); } catch { /* 已死就算了 */ }
    const t = setTimeout(() => { try { p.kill(); } catch { /* 同上 */ } }, 1500);
    if (t.unref) t.unref();
  }
}

const num = (v) => (v === null ? null : Number(v));
const sq = (s) => String(s).replace(/'/g, "''"); // SQL 字面量转义；身份锚点是适配器自己生成的 ASCII 用户名，转义是纵深防御
export function createTaixianglianSqlAdapter(options = {}) {
  const opt = { ...SQL_DEFAULTS, ...options };
  const inner = createTaixianglianAdapter(options); // execute 通道：与 HTTP 适配器同源，一字不改
  const shell = new H2Shell(opt);
  const runs = new Map(); // runId → 本 run 顾客用户名（SQL 身份过滤锚点）

  const manifest = async () => ({
    ...TAIXIANGLIAN_MANIFEST,
    adapter: 'taixianglian-sql',
    adapter_version: '1.0.0',
    description: '咖啡店后台：execute 与 HTTP 适配器同源，observe 改走 SQL 直读（写后事实层第二通道）',
    reset_note:
      'identity：与 HTTP 适配器相同的账号注册复位；观测通道是外部进程 SQL 直读，视角锚定在账号属主上。',
  });

  // —— SQL → canonical view 映射表（只此一份）——
  // orders.createTime 投影 null：HTTP 通道从响应体拿 ISO 纳秒串，表里没有同形
  // 字段；它不在 view.required 里，投影 null 最诚实。pickupNo=100+id 是后端
  // 确定逻辑（取餐号规则），derived 进投影并在 compare 里对账。
  async function observeState(runId) {
    const username = runs.get(runId);
    if (!username) throw new Error(`运行 ${runId} 不存在`);
    const u = sq(username);
    const menuR = await shell.query('SELECT id, dish_name, price, category FROM t_menu ORDER BY id');
    const menu = menuR.rows.map((r) => ({
      id: num(r.ID), dishName: r.DISH_NAME, price: num(r.PRICE), category: r.CATEGORY,
    }));
    const orderR = await shell.query(
      'SELECT o.id, o.username, o.status, o.total_amount, 100 + o.id AS pickup_no'
      + " FROM t_order o WHERE o.username = '" + u + "'"
      + ' ORDER BY o.create_time DESC, o.id DESC');
    const orders = orderR.rows.map((r) => ({
      id: num(r.ID), username: r.USERNAME, status: r.STATUS,
      totalAmount: num(r.TOTAL_AMOUNT), pickupNo: num(r.PICKUP_NO), createTime: null, items: [],
    }));
    if (orders.length > 0) {
      const itemR = await shell.query(
        'SELECT i.order_id, i.dish_name, i.count, i.unit_price, i.sub_total'
        + ' FROM t_order_item i JOIN t_order o ON i.order_id = o.id'
        + " WHERE o.username = '" + u + "' ORDER BY i.id");
      const byOrder = new Map();
      for (const r of itemR.rows) {
        const oid = num(r.ORDER_ID);
        if (!byOrder.has(oid)) byOrder.set(oid, []);
        byOrder.get(oid).push({
          dishName: r.DISH_NAME, count: num(r.COUNT),
          unitPrice: num(r.UNIT_PRICE), subTotal: num(r.SUB_TOTAL),
        });
      }
      for (const o of orders) o.items = byOrder.get(o.id) ?? [];
    }
    const logR = await shell.query(
      'SELECT l.order_id, ROW_NUMBER() OVER (PARTITION BY l.order_id ORDER BY l.id) AS seq,'
      + ' l.from_status, l.to_status, l.operator_name, l.operator_role, l.note,'
      + " FORMATDATETIME(l.created_at, 'yyyy-MM-dd HH:mm:ss') AS at_s"
      + ' FROM t_order_status_log l JOIN t_order o ON l.order_id = o.id'
      + " WHERE o.username = '" + u + "' ORDER BY l.order_id, l.id");
    const status_log = logR.rows.map((r) => ({
      id: `${r.ORDER_ID}:${Number(r.SEQ) - 1}`,
      type: `order.${String(r.TO_STATUS ?? '').toLowerCase()}`,
      orderId: num(r.ORDER_ID), from: r.FROM_STATUS, to: r.TO_STATUS,
      by: r.OPERATOR_NAME, role: r.OPERATOR_ROLE, note: r.NOTE, at: r.AT_S,
    }));
    return { menu, orders, status_log };
  }
  async function observe(runId) {
    try {
      return { state: await observeState(runId), missingScopes: [] };
    } catch (e) {
      return { state: null, missingScopes: TAIXIANGLIAN_MANIFEST.scopes, reason: e && e.message };
    }
  }

  async function reset() {
    const r = await inner.reset();
    runs.set(r.runId, r.roleBindings.customer);
    return r;
  }

  async function close(runId) {
    runs.delete(runId);
    await inner.close(runId);
  }

  return {
    manifest, reset, observe, execute: inner.execute, close,
    baseUrl: inner.baseUrl, toStep: inner.toStep,
    dispose: () => shell.stop(), // 非契约方法：彻底关掉观测子进程（幂等）
  };
}

export function validateTaixianglianSqlAdapter() {
  const m = { ...TAIXIANGLIAN_MANIFEST, adapter: 'taixianglian-sql', adapter_version: '1.0.0' };
  return validateManifest(m);
}

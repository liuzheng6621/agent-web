/**
 * tap：反向代理录制器。用户把流量指过来，用它五分钟，得到一份 traffic.jsonl。
 *
 * 为什么是反向代理而不是 HTTP proxy / 浏览器插件：
 *   - 反向代理只要改一个 base url，浏览器、curl、Agent 都不用配置；
 *   - 不碰 TLS：v1 只服务 http 的本地/内网目标，https 留给人自己决定怎么终接；
 *   - 录的是请求/响应对，不录 DOM、不录操作——我们录状态，不录动作。
 *
 * 红线（写进启动提示，也写进 README）：
 *   - 流量会真的打到目标。对生产库录写操作是使用者的选择，与 --writes 同级。
 *   - 鉴权头/cookie 的原值绝不落盘：落盘的是假名（bearer#1 / cookie#2）。
 *   - 响应体超过 256KB 或非 json/text 不落正文，只落形状。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const TAP_VERSION = 'agent-web/tap-1';
const SECRET_HEADERS = ['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key', 'token'];
const MAX_BODY = 256 * 1024;

function isTextish(type) {
  return !type || /json|text|xml|urlencoded/.test(type);
}

export function startTap({ target, port, out, onLine = null, quiet = false }) {
  const baseUrl = String(target).replace(/\/$/, '');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'traffic.jsonl');
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const secrets = new Map();
  let seq = 0;

  function pseudonym(name, value) {
    const key = `${name}:${value}`;
    if (!secrets.has(key)) secrets.set(key, `${name}#${secrets.size + 1}`);
    return secrets.get(key);
  }

  function cleanHeaders(headers) {
    const outH = {};
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (SECRET_HEADERS.includes(lk)) {
        outH[lk] = pseudonym(lk === 'authorization' ? 'bearer' : lk, String(v));
      } else if (lk !== 'host' && lk !== 'connection') {
        outH[lk] = v;
      }
    }
    return outH;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const reqBody = Buffer.concat(chunks);
      seq += 1;
      const mySeq = seq;
      const url = new URL(req.url, 'http://tap');
      const record = {
        v: TAP_VERSION,
        seq: mySeq,
        ts: Date.now(),
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        req_headers: cleanHeaders(req.headers),
        req_body: reqBody.length && isTextish(req.headers['content-type']) ? redactBody(safeText(reqBody), pseudonym) : null,
        req_body_bytes: reqBody.length,
      };
      try {
        const upstream = await fetch(baseUrl + url.pathname + url.search, {
          method: req.method,
          headers: { ...req.headers, host: new URL(baseUrl).host },
          body: reqBody.length ? reqBody : undefined,
        });
        const resBuf = Buffer.from(await upstream.arrayBuffer());
        const type = upstream.headers.get('content-type') || '';
        record.status = upstream.status;
        record.res_type = type;
        record.res_headers = cleanHeaders(Object.fromEntries(upstream.headers));
        if (resBuf.length <= MAX_BODY && isTextish(type)) record.res_body = redactBody(safeText(resBuf), pseudonym);
        else record.res_body = null;
        record.res_body_bytes = resBuf.length;
        res.writeHead(upstream.status, passthroughHeaders(upstream.headers));
        res.end(resBuf);
      } catch (e) {
        record.status = 599;
        record.res_body = null;
        record.error = String(e && e.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'tap_upstream', message: record.error }));
      }
      const line = JSON.stringify(record);
      stream.write(line + '\n');
      if (onLine) onLine(record);
      if (!quiet) process.stderr.write(`tap ${String(mySeq).padStart(3)} ${record.method} ${record.path} -> ${record.status}\n`);
    });
  });

  server.listen(port, '127.0.0.1');
  return {
    file,
    port,
    url: `http://127.0.0.1:${port}`,
    stop() {
      return new Promise((resolve) => {
        server.close(() => {
          stream.end(() => resolve({ file, lines: seq }));
        });
      });
    },
  };
}

const SECRET_KEYS = /(token|password|passwd|secret|api[-_]?key|authorization|cookie)/i;

/** 落盘前把正文里的凭据类字段换成假名：选择器认路径不认值，脱敏不伤学习。 */
function redactBody(text, pseudonym) {
  if (text === null) return null;
  try {
    const obj = JSON.parse(text);
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
          out[k] = SECRET_KEYS.test(k) && typeof val === 'string' && val !== '' ? pseudonym(k.toLowerCase(), val) : walk(val);
        }
        return out;
      }
      return v;
    };
    return JSON.stringify(walk(obj));
  } catch {
    return text;
  }
}

function safeText(buf) {
  try {
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function passthroughHeaders(headers) {
  const outH = {};
  for (const [k, v] of headers) {
    const lk = k.toLowerCase();
    if (lk === 'content-length' || lk === 'connection' || lk === 'transfer-encoding') continue;
    if (SECRET_HEADERS.includes(lk)) continue;
    outH[k] = v;
  }
  return outH;
}

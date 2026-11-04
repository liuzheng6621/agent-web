#!/usr/bin/env node
/**
 * scripts/gh-proxy.mjs —— 只做一件事的本地 CONNECT 代理：
 * 让 git 在「hosts 把 github.com 指到 127.0.0.1」的机器上仍能连上 GitHub。
 *
 * 为什么需要它
 *   C:\Windows\System32\drivers\etc\hosts 里可能有一批这样的行：
 *     127.0.0.1 github.com
 *     127.0.0.1 api.github.com
 *     127.0.0.1 raw.githubusercontent.com
 *   本机 443 没有服务在听，TLS 握手直接失败。症状很好认：
 *     curl https://github.com → 000，且 dns≈0.007s、conn≈0.008s、tls=0.000s
 *   —— 连接快得不正常，TLS 根本没开始。改 hosts 要管理员权限，还可能被
 *   当初写这些行的脚本覆盖回去，所以不改它。
 *
 * 做法
 *   收到 CONNECT host:port 后，用 dns.resolve4() 直接问 DNS 服务器（这一步
 *   绕过 hosts 文件的本地解析），拿到真实 IP 再建隧道，字节原样转发。
 *   TLS 是 git 与目标端到端握手的，SNI 仍是原来的域名，所以证书校验正常
 *   通过，不需要 -c http.sslVerify=false 这种把安全关掉的写法。
 *
 * 用法
 *   node scripts/gh-proxy.mjs &                                    # 默认 127.0.0.1:8899
 *   git -c http.proxy=http://127.0.0.1:8899 push github main
 *
 * 也可以只给这一个远端设上，省得每次带参数：
 *   git config --local http.https://github.com.proxy http://127.0.0.1:8899
 *   （用它之前记得代理是活的，代理关掉后 push 会连不上，要删掉这条配置）
 *
 * 边界
 *   只监听 127.0.0.1，不对外暴露；它会把任意 CONNECT 透传到 DNS 解出的地址，
 *   用完请关掉。它不是 VPN，也不是加速器，只解决「域名被 hosts 黑洞」这一件事。
 */

import net from 'node:net';
import { promises as dnsP } from 'node:dns';

const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const PORT = Number(portFlag >= 0 ? argv[portFlag + 1] : (argv[0] ?? 8899));

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${stamp()}] ` + a.join(' '));

async function resolveReal(host) {
  try {
    const v4 = await dnsP.resolve4(host);
    if (v4.length) return v4[0];
  } catch {}
  try {
    const v6 = await dnsP.resolve6(host);
    if (v6.length) return v6[0];
  } catch {}
  return null;
}

const server = net.createServer((client) => {
  client.on('error', () => client.destroy());
  client.once('data', async (buf) => {
    const head = buf.toString('latin1');
    const m = /^CONNECT ([^:\s]+):(\d+) HTTP\/1\.[01]\r\n/.exec(head);
    if (!m) {
      client.end('HTTP/1.1 405 Method Not Allowed\r\nAllow: CONNECT\r\n\r\n');
      return;
    }
    const host = m[1];
    const port = Number(m[2]);
    const ip = await resolveReal(host);
    if (!ip) {
      log('RESOLVE-FAIL', host);
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host: ip, port }, () => {
      log('CONNECT', `${host}:${port}`, '->', ip);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', (e) => {
      log('UPSTREAM-ERROR', host, e.code ?? e.message);
      client.destroy();
    });
    client.on('close', () => upstream.destroy());
  });
});

server.on('error', (e) => {
  console.error('监听失败：' + (e.code ?? e.message));
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening 127.0.0.1:${PORT}`);
  log(`git -c http.proxy=http://127.0.0.1:${PORT} push github main`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('bye');
    server.close(() => process.exit(0));
  });
}

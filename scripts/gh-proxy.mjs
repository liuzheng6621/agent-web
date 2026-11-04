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
 *   TLS 是 libcurl/git 与目标端到端握手的，SNI 仍是原来的域名，所以证书
 *   校验正常通过，不需要 -c http.sslVerify=false 这种把安全关掉的写法。
 *
 * 多 IP 兜底
 *   GitHub 前面的地址不止一个，而且会时通时不通（写这段时 DNS 给的
 *   20.205.243.166 失败，140.82.114.4 / 140.82.112.4 正常）。所以代理会把
 *   解析出的地址逐个试，还不行就试一小份已知可用的备用地址；也可以自己指定：
 *     node scripts/gh-proxy.mjs --ip=140.82.114.4
 *
 * 用法
 *   node scripts/gh-proxy.mjs &                                    # 默认 127.0.0.1:8899
 *   git -c http.proxy=http://127.0.0.1:8899 push github main
 *
 * 只给这一个远端设上，省得每次带参数（代理关掉后记得删掉这条配置）：
 *   git config --local http.https://github.com.proxy http://127.0.0.1:8899
 *
 * 边界
 *   只监听 127.0.0.1，不对外暴露；它会把任意 CONNECT 透传到解析出的地址，
 *   用完请关掉。它不是 VPN，也不是加速器，只解决「域名被 hosts 黑洞」这一件事。
 */

import net from 'node:net';
import { promises as dnsP } from 'node:dns';

const argv = process.argv.slice(2);
const readFlag = (name) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PORT = Number(readFlag('port') ?? 8899);
const FORCED_IPS = (readFlag('ip') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// 已知可用的 GitHub 地址，作为 DNS 结果全都连不上时的兜底。
// 它会随时间变化：真连不上就 curl --resolve github.com:443:<ip> 逐个试，再 --ip 指定。
const FALLBACK = ['140.82.114.4', '140.82.112.4', '140.82.113.4', '20.205.243.166'];

const CONNECT_TIMEOUT_MS = 6000;
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${stamp()}] ` + a.join(' '));

async function resolveAll(host) {
  const out = [];
  for (const fn of ['resolve4', 'resolve6']) {
    try {
      const ips = await dnsP[fn](host);
      out.push(...ips);
    } catch {}
  }
  return out;
}

async function candidateIps(host) {
  if (FORCED_IPS.length) return FORCED_IPS;
  const resolved = await resolveAll(host);
  const pool = host === 'github.com' ? [...resolved, ...FALLBACK] : resolved;
  return [...new Set(pool)];
}

function connectOnce(ip, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' }));
    }, CONNECT_TIMEOUT_MS);
    sock.once('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// allowHalfOpen: git 写完请求会半关闭，另一半还要继续读响应。默认 false 会在
// FIN 之后销毁 socket，表现成 schannel: server closed abruptly (missing close_notify)。
const server = net.createServer({ allowHalfOpen: true }, (client) => {
  client.on('error', () => client.destroy());
  client.once('data', async (buf) => {
    const m = /^CONNECT ([^:\s]+):(\d+) HTTP\/1\.[01]\r\n/.exec(buf.toString('latin1'));
    if (!m) {
      client.end('HTTP/1.1 405 Method Not Allowed\r\nAllow: CONNECT\r\n\r\n');
      return;
    }
    const host = m[1];
    const port = Number(m[2]);
    const ips = await candidateIps(host);
    if (!ips.length) {
      log('RESOLVE-FAIL', host);
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }

    let upstream = null;
    for (const ip of ips) {
      try {
        upstream = await connectOnce(ip, port);
        log('CONNECT', `${host}:${port}`, '->', ip);
        break;
      } catch (e) {
        log('RETRY', `${host} ${ip}`, e.code ?? e.message);
      }
    }
    if (!upstream) {
      log('GIVE-UP', host);
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }

    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.pipe(client);
    client.pipe(upstream);
    upstream.on('error', (e) => {
      log('UPSTREAM-ERROR', host, e.code ?? e.message);
      client.destroy();
    });
    upstream.on('end', () => client.end());
    client.on('end', () => upstream.end());
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

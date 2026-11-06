/**
 * 交叉复核用的最小 HTTP 站点。零依赖，进程内起，测试与 CLI 都能用。
 * 数据是固定的，所以两个通道看到的应该完全一样。
 */
import http from 'node:http';

export const ARTICLES = [
  { slug: 'a-one', title: '第一篇', body: 'x' },
  { slug: 'a-two', title: '第二篇', body: 'y' },
  { slug: 'a-three', title: '第三篇', body: 'z' },
];
export const TAGS = [{ name: 'alpha' }, { name: 'beta' }];

export function startSite(port = 8499) {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url === '/api/articles') return send(200, ARTICLES);
    if (url === '/api/tags') return send(200, TAGS);
    return send(404, { errors: { body: ['not found'] } });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port, close: () => server.close() }));
  });
}

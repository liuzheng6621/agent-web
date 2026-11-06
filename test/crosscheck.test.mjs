import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintOf, verdictOf, exitOf, summarize, DEFAULT_VOLATILE } from '../src/assert/crosscheck.mjs';
import { crosscheck, isHttpAdapter, pickReadCapabilities } from '../src/crosscheck.mjs';
import { startSite, ARTICLES, TAGS } from './fixtures/http-site.mjs';
import { createAdapter as createLying } from './fixtures/lying-http-adapter.mjs';

// ---------- 纯函数层 ----------

test('指纹：每次都变的字段不算差异（否则正确实现也会判 divergent）', () => {
  const a = { articles: [{ id: 1, at: 1000, title: 'x' }], total: 1 };
  const b = { articles: [{ id: 2, at: 2000, title: 'x' }], total: 1 };
  assert.equal(fingerprintOf(a), fingerprintOf(b), 'id 与 at 都被 DEFAULT_VOLATILE 剔掉了');
});

test('指纹：内容真的不同就必须不同', () => {
  const a = { articles: [{ title: 'x' }] };
  const b = { articles: [{ title: 'y' }] };
  assert.notEqual(fingerprintOf(a), fingerprintOf(b));
});

test('指纹：数组顺序变化会被发现（顺序是数据的一部分）', () => {
  const a = { t: [{ name: 'a' }, { name: 'b' }] };
  const b = { t: [{ name: 'b' }, { name: 'a' }] };
  assert.notEqual(fingerprintOf(a), fingerprintOf(b));
});

test('指纹：长度变化会被发现（砍掉一条是最常见的谎）', () => {
  const a = { t: [{ name: 'a' }, { name: 'b' }] };
  const b = { t: [{ name: 'a' }] };
  assert.notEqual(fingerprintOf(a), fingerprintOf(b));
});

test('指纹：键顺序不影响结果（稳定序列化）', () => {
  assert.equal(fingerprintOf({ a: 1, b: 2 }), fingerprintOf({ b: 2, a: 1 }));
});

test('不走 HTTP → uncheckable，且不能算通过', () => {
  const v = verdictOf({ httpAdapter: false, reason: '内存适配器' });
  assert.equal(v.status, 'uncheckable');
  assert.equal(v.code, 'not_http');
  assert.match(v.message, /内存适配器/);
});

test('有一个通道没拿到响应 → uncheckable，不是 consistent', () => {
  const v = verdictOf({ httpAdapter: true, viaAdapter: undefined, viaDirect: { a: 1 } });
  assert.equal(v.status, 'uncheckable');
  assert.equal(v.code, 'missing_response');
  assert.match(v.message, /拿不到就不能声称一致/);
});

test('退出码：有 divergent 就是 1；全 consistent 才 0；全查不了是 2', () => {
  assert.equal(exitOf([{ status: 'consistent' }, { status: 'divergent' }]), 1);
  assert.equal(exitOf([{ status: 'consistent' }, { status: 'consistent' }]), 0);
  assert.equal(exitOf([{ status: 'uncheckable' }, { status: 'uncheckable' }]), 2);
  assert.equal(exitOf([]), 2, '一条都没查，不是成功');
});

test('汇总：查不了的不能进分母', () => {
  const s = summarize([
    { status: 'consistent' }, { status: 'consistent' },
    { status: 'divergent' },
    { status: 'uncheckable' }, { status: 'uncheckable' },
  ]);
  assert.equal(s.total, 5);
  assert.equal(s.checkable, 3, '分母只该算能查的');
  assert.equal(Math.round(s.rate * 100) / 100, 0.67);
});

test('汇总：一条都查不了时 rate 是 null，不是 0', () => {
  const s = summarize([{ status: 'uncheckable' }]);
  assert.equal(s.rate, null, '「查不了」不是「0% 一致」，是「没有证据」');
});

test('isHttpAdapter：有 baseUrl 或有 http 路径才算', () => {
  assert.equal(isHttpAdapter({ baseUrl: 'http://x' }, null), true);
  assert.equal(isHttpAdapter({ capabilities: [{ id: 'a', http: '/api/a' }] }, null), true);
  assert.equal(isHttpAdapter({ capabilities: [{ id: 'a' }] }, null), false);
});

test('pickReadCapabilities：只挑读且不需要参数的能力', () => {
  const caps = pickReadCapabilities({
    capabilities: [
      { id: 'a.list', kind: 'read', args: {} },
      { id: 'a.get', kind: 'read', args: { id: 'number' } },
      { id: 'a.create', kind: 'write', args: {} },
    ],
  });
  assert.deepEqual(caps.map((c) => c.id), ['a.list'], '需要参数的读能力复核不了：独立通道不知道该填什么');
});

// ---------- 端到端 ----------

test('端到端：撒谎的适配器必须被抓住，诚实的那条必须放过', async () => {
  const site = await startSite(8491);
  try {
    const adapter = createLying();
    const report = await crosscheck({ adapter, adapterName: 'lying-http' });
    const byCap = new Map(report.rows.map((r) => [r.capability, r]));
    assert.equal(byCap.get('articles.list').status, 'divergent', '改了标题又砍了一条，必须报不一致');
    assert.equal(byCap.get('tags.list').status, 'consistent', '原样转发的那条必须放过——检测器不能见谁咬谁');
    assert.equal(report.exitCode, 1);
    assert.match(byCap.get('articles.list').adapter, /TAMPERED/);
    assert.ok(!byCap.get('articles.list').direct.includes('TAMPERED'), '独立通道拿到的是真数据');
  } finally {
    site.close();
  }
});

test('端到端：不撒谎时全部一致（证明检测器不是恒红）', async () => {
  const site = await startSite(8492);
  try {
    const honest = {
      manifest: async () => ({
        name: 'honest',
        baseUrl: 'http://127.0.0.1:8492',
        capabilities: [
          { id: 'articles.list', kind: 'read', args: {}, http: '/api/articles' },
          { id: 'tags.list', kind: 'read', args: {}, http: '/api/tags' },
        ],
      }),
      reset: async () => ({ runId: 'r', state: {} }),
      observe: async () => ({ state: {}, missingScopes: [] }),
      execute: async (_r, action) => {
        const path = action.capability === 'articles.list' ? '/api/articles' : '/api/tags';
        const res = await globalThis.fetch('http://127.0.0.1:8492' + path);
        return { outcome: 'applied', payload: await res.json() };
      },
      close: async () => {},
    };
    const report = await crosscheck({ adapter: honest, adapterName: 'honest' });
    assert.equal(report.summary.consistent, 2);
    assert.equal(report.summary.divergent, 0);
    assert.equal(report.exitCode, 0);
  } finally {
    site.close();
  }
});

test('端到端：内存适配器 → 全部 uncheckable，exit 2', async () => {
  const { createMemoryAdapter } = await import('../src/adapter/memory.mjs');
  const report = await crosscheck({ adapter: createMemoryAdapter(), adapterName: 'memory' });
  assert.equal(report.rows.length, 0);
  assert.equal(report.exitCode, 2);
  assert.match(report.reason, /不走 HTTP/);
});

test('端到端：站点不通 → uncheckable，不是 divergent（分不清「说谎」与「连不上」）', async () => {
  const adapter = createLying();
  const report = await crosscheck({ adapter, adapterName: 'lying-http', baseUrl: 'http://127.0.0.1:8498', timeoutMs: 2000 });
  for (const r of report.rows) {
    assert.equal(r.status, 'uncheckable', '连不上不等于撒谎，必须记成查不了');
  }
  assert.equal(report.exitCode, 2);
});

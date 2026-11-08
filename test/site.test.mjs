// Pages 站点互锁守卫：站点首屏数字来自 LIMITS L5 实测口径，
// 换版本时漏改这里 = 线上演示页说谎。与台账互锁守卫同一套纪律。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('站点首屏数字与 LIMITS L5 当前口径逐字一致', () => {
  const limits = read('docs/LIMITS.md');
  const m = limits.match(/当前口径：([0-9]+) 个变异体，.*?适用 ([0-9]+)，抓到 ([0-9]+)（([0-9.]+)%）/);
  assert.ok(m, 'LIMITS.md 里找不到「当前口径」行');
  const [, mutants, applicable, caught, rate] = m;
  const site = read('site/index.html');
  assert.ok(site.includes('>' + mutants + '<'), '站点变异体数卡片与 L5 不一致');
  assert.ok(site.includes(caught + '/' + applicable), '站点抓获数卡片与 L5 不一致（' + caught + '/' + applicable + '）');
  assert.ok(site.includes(rate + '%'), '站点百分比与 L5 不一致（' + rate + '%）');
  // 口径纪律：是 caught/applicable，不是 caught/mutants
  assert.ok(site.includes(applicable + ' 种') || site.includes('适用的 ' + applicable), '站点必须写明适用的分母口径');
});

test('版本号占位符存在，workflow 才有东西可替换', () => {
  const site = read('site/index.html');
  assert.equal((site.match(/[{][{]VERSION[}][}]/g) || []).length, 2);
  const wf = read('.github/workflows/pages.yml');
  assert.ok(wf.includes('{{VERSION}}'), 'workflow 必须替换占位符');
  assert.ok(wf.includes('cat VERSION'), 'workflow 必须从 VERSION 取版本号');
});

test('站点链接的三个页面都在 workflow 构建产物里', () => {
  const site = read('site/index.html');
  const wf = read('.github/workflows/pages.yml');
  for (const page of ['index.html', 'coffee.dashboard.html', 'happy-path.flow.html']) {
    assert.ok(site.includes(page) || page === 'index.html', '站点未链接 ' + page);
    assert.ok(wf.includes(page), 'workflow 未生成 ' + page);
  }
});

test('Pages 的判决是这次 CI 真跑出来的，不是手工填的', () => {
  const wf = read('.github/workflows/pages.yml');
  assert.ok(wf.includes('verify cases/coffee --adapter=memory'), '缺 verify 真实判决');
  assert.ok(/flow cases\/coffee[\s\S]*?--result=/.test(wf), 'dashboard 的 flow 必须带 --result');
  assert.ok(/flow cases\/coffee\/happy-path\.json[\s\S]*?--result=/.test(wf), '单案例 flow 必须带 --result');
  assert.ok(wf.includes('actions/upload-pages-artifact@v3'));
  assert.ok(wf.includes('actions/deploy-pages@v4'));
});

test('构建产物不许带口令或 token', () => {
  const wf = read('.github/workflows/pages.yml');
  assert.ok(/grep -rEi/.test(wf) && wf.includes('_site/'), 'workflow 必须有产物敏感扫描');
});

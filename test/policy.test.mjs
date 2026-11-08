import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// L3 语义层的守卫。这里守三件不同的事，缺一件这条链就退化成「自己证明自己」：
//
//   1. 策略文件与判例都在（结构守卫，不需要 conftest）
//   2. 胶水的翻译规则没漂（纯函数守卫，不需要 conftest）
//   3. conftest 真能把好例放行、坏例拦下（执行守卫，缺 conftest 时跳过并明示）
//
// 第 3 条是本文件唯一依赖外部二进制的测试。它 skip 而不是 fail，
// 是因为「没装 conftest」是环境问题不是代码问题；但 skip 会出现在 TAP 输出里，
// 不会被静默吞掉。

const FIXTURE_DIR = path.join(ROOT, 'policy', 'fixtures');
const fixtures = fs.existsSync(FIXTURE_DIR)
  ? fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort()
  : [];

function conftestBin() {
  const cand = process.env.CONFTEST_BIN || 'conftest';
  const probe = spawnSync(cand, ['--version'], { encoding: 'utf8' });
  return probe.error || probe.status !== 0 ? null : cand;
}

test('policy: 规则、判例、决策记录三样都在', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'policy', 'coffee.rego')), '缺 policy/coffee.rego');
  assert.ok(fs.existsSync(path.join(ROOT, 'policy', 'DECISIONS.md')), '缺 policy/DECISIONS.md');
  assert.ok(fs.existsSync(path.join(ROOT, 'policy', 'glue.mjs')), '缺 policy/glue.mjs');
  assert.ok(fixtures.length >= 12, `判例太少：只有 ${fixtures.length} 条`);
});

test('policy: 每条判例都有期望标签，good/bad 前缀与内容一致', () => {
  for (const f of fixtures) {
    const doc = JSON.parse(read(path.join('policy', 'fixtures', f)));
    assert.ok(Array.isArray(doc.events) && doc.events.length > 0, `${f} 没有事件序列`);
    assert.ok(Array.isArray(doc.orders) && doc.orders.length > 0, `${f} 没有订单快照`);
    const good = f.startsWith('good-');
    const bad = f.startsWith('bad-');
    assert.ok(good || bad, `${f} 文件名必须 good- 或 bad- 开头（这是期望声明）`);
    if (bad) {
      // 坏例必须真的坏：不能与好例逐字相同（同构复制会让执行守卫假绿）
      const goodDoc = JSON.parse(read(path.join('policy', 'fixtures', 'good-happy-path.json')));
      assert.notEqual(JSON.stringify(doc), JSON.stringify(goodDoc), f + ' 与好例一模一样');
    }
  }
});

test('policy: DECISIONS.md 里列的每条规则都有判例，每条判例都归到规则', () => {
  const decisions = read('policy/DECISIONS.md');
  const declared = [...decisions.matchAll(/^\| (R\d+) \|/gm)].map((m) => m[1]);
  assert.ok(declared.length >= 8, `DECISIONS.md 只声明了 ${declared.length} 条规则`);
  for (const r of declared) {
    // 判例文件里不写规则号（写了就等于让策略自己证明自己），
    // 所以只要求表格行指向具体 fixture；「这条规则真的会拦」
    // 由最后的 conftest 执行守卫反向验证。
    const row = decisions.split('\n').find((l) => l.startsWith(`| ${r} |`));
    assert.ok(row, `${r} 没有表格行`);
    assert.ok(/`bad-|`good-/.test(row), `${r} 的判例行没有指向任何 fixture`);
  }
});

test('policy: 胶水只搬运不计算 —— 除起点事件外不合成任何字段', async () => {
  const { viewToPolicyInput } = await import('../policy/glue.mjs');
  const view = {
    orders: [{ id: 7, username: 'u1', status: 'MAKING', totalAmount: 56,
      items: [{ dishName: '拿铁', count: 2, unitPrice: 28, subTotal: 56 }] }],
    status_log: [{ orderId: 7, from: 'PENDING', to: 'MAKING', by: 'barista',
      role: 'STAFF', at: '2026-11-08 10:00:00' }],
  };
  const out = viewToPolicyInput({ view, identities: { u1: 11, barista: 12 } });
  assert.equal(out.orders[0].totalAmount, 56, '总额必须原样搬运');
  assert.equal(out.orders[0].userId, 11, '属主 id 必须来自显式映射');
  assert.equal(out.orders[0].items[0].subTotal, 56, '小计必须原样搬运');
  const real = out.events.filter((e) => !e.synthetic);
  assert.equal(real.length, 1, '真实事件不得被增删');
  assert.equal(real[0].operatorId, 12, '操作人 id 必须来自显式映射');
  const synth = out.events.filter((e) => e.synthetic);
  assert.equal(synth.length, 1, '只允许合成一条起点事件');
  assert.equal(synth[0].from, null);
  assert.equal(synth[0].to, 'PENDING');
  assert.equal(synth[0].operatorId, 11, '起点事件的操作人必须是订单属主');
});

test('policy: 胶水不猜身份 —— 查不到就写 null，让 R7 报出来', async () => {
  const { viewToPolicyInput } = await import('../policy/glue.mjs');
  const view = {
    orders: [{ id: 1, username: 'ghost', status: 'PENDING', totalAmount: 28, items: [] }],
    status_log: [{ orderId: 1, from: 'PENDING', to: 'CANCELED', by: 'ghost',
      role: 'CUSTOMER', at: '2026-11-08 10:00:00' }],
  };
  const out = viewToPolicyInput({ view, identities: {} });
  assert.equal(out.orders[0].userId, null, '查不到必须写 null，不许猜');
  assert.equal(out.events.find((e) => !e.synthetic).operatorId, null);
});

test('policy: SYSTEM 角色不带 operatorId（系统任务没有 id）', async () => {
  const { viewToPolicyInput } = await import('../policy/glue.mjs');
  const view = {
    orders: [{ id: 2, username: 'u1', status: 'CANCELED', totalAmount: 28, items: [] }],
    status_log: [{ orderId: 2, from: 'PENDING', to: 'CANCELED', by: '系统',
      role: 'SYSTEM', at: '2026-11-08 10:05:00' }],
  };
  const out = viewToPolicyInput({ view, identities: { u1: 5 } });
  const sys = out.events.find((e) => e.operatorRole === 'SYSTEM');
  assert.equal(sys.operatorId, null);
});

test('policy: 已有起点事件时不重复合成', async () => {
  const { viewToPolicyInput } = await import('../policy/glue.mjs');
  const view = {
    orders: [{ id: 3, username: 'u1', status: 'PENDING', totalAmount: 28, items: [] }],
    status_log: [{ orderId: 3, from: null, to: 'PENDING', by: 'u1',
      role: 'CUSTOMER', at: '2026-11-08 10:00:00' }],
  };
  const out = viewToPolicyInput({ view, identities: { u1: 1 } });
  assert.equal(out.events.filter((e) => e.synthetic).length, 0, '不该重复补起点');
  assert.equal(out.events.length, 1);
});

test('policy: conftest 把好例放行、坏例拦下（缺 conftest 则跳过）', { skip: conftestBin() ? false : 'conftest 不在 PATH（可用 CONFTEST_BIN 指定）' }, () => {
  const bin = conftestBin();
  for (const f of fixtures) {
    const full = path.join(FIXTURE_DIR, f);
    const r = spawnSync(bin, ['test', '-p', 'policy', '--namespace', 'coffee', full],
      { encoding: 'utf8', cwd: ROOT });
    const want = f.startsWith('good-') ? 0 : 1;
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-4).join('\n');
    assert.equal(r.status, want, `${f}：期望 rc=${want}，实得 rc=${r.status}\n${out}`);
  }
});

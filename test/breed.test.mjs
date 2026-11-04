import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BREED_VERSION, collectLeaves, planMutants, renderMutant, breedMutants, loadBredMutants,
} from '../src/breed.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';

const OUT = '.tmp-breed-test';

const fixture = () => ({
  orders: [{
    id: 1001, username: 'alice', status: 'MAKING', totalAmount: 56, pickupNo: 1101, createTime: 1,
    items: [{ dishName: '拿铁', count: 2, unitPrice: 28, subTotal: 56 }],
  }],
  menu: [{ id: 1, dishName: '拿铁', price: 28, category: '咖啡' }],
});

test('breed：位置探测看得见数值、文本和嵌套明细', () => {
  const leaves = collectLeaves(fixture());
  const paths = leaves.map((l) => l.collection + '.' + l.index + '.' + l.path);
  assert.ok(paths.includes('orders.0.status'), '应看到 orders[0].status');
  assert.ok(paths.includes('orders.0.totalAmount'));
  assert.ok(paths.includes('orders.0.items.0.count'), '嵌套明细也要看到');
  assert.ok(paths.includes('menu.0.price'));
});

test('breed：不可移植的字段不造故障（id / createTime / pickupNo / username）', () => {
  const paths = collectLeaves(fixture()).map((l) => l.path);
  for (const bad of ['id', 'createTime', 'pickupNo', 'username']) {
    assert.equal(paths.includes(bad), false, bad + ' 不该出现在造故障的范围里');
  }
});

test('breed：恒等算子不生成——已经是大写的值再转大写等于没改', () => {
  const plan = planMutants(fixture());
  const ids = plan.map((p) => p.id);
  assert.equal(ids.some((id) => id.includes('upper-orders-0-status')), false, "MAKING 转大写还是 MAKING，不该生成");
  assert.equal(ids.some((id) => id.includes('upper-orders-0-items-0-dishname')), false, "'拿铁' 没有大小写，不该生成");
  assert.ok(ids.some((id) => id.includes('prefix-orders-0-status')), '加前缀始终有差别，必须生成');
  assert.ok(plan.noop.length > 0, '被跳过的数量要能报出来');
});

test('breed：整数金额不该生成"除以 100"的算子（那是有差别的，相反的情形才跳过）', () => {
  const plan = planMutants(fixture());
  const ids = plan.map((p) => p.id);
  assert.ok(ids.some((id) => id.includes('cent-orders-0-totalamount')), '56 / 100 = 0.56 有差别，要生成');
});

test('breed：生成的 id 符合变异体目录的命名约束', () => {
  for (const p of planMutants(fixture(), { max: 100 })) {
    assert.match(p.id, /^m-[a-z0-9]+(-[a-z0-9]+)*$/, p.id);
  }
});

test('breed：生成的源码能被 import，且 wrap 之后状态真的变了', async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const plan = planMutants(fixture(), { max: 100 });
  const target = plan.find((p) => p.id.includes('off-by-one-orders-0-totalamount'));
  assert.ok(target, '应当有 totalAmount 差一这个变异体');
  const file = path.join(OUT, target.id + '.mjs');
  fs.writeFileSync(file, renderMutant(target), 'utf8');

  const mod = await import(pathToFileURL(path.resolve(file)).href);
  assert.equal(mod.meta.id, target.id);
  assert.equal(typeof mod.wrap, 'function');
  assert.equal(mod.meta.generated, true);
  assert.equal(mod.meta.breed_version, BREED_VERSION);

  const broken = mod.wrap(createMemoryAdapter());
  const reset = await broken.reset({});
  await broken.execute(reset.runId, {
    capability: 'order.create', as: 'customer', arguments: { items: [{ dishName: '拿铁', count: 2 }] },
  });
  const seen = await broken.observe(reset.runId, ['orders']);

  const clean = createMemoryAdapter();
  const cleanReset = await clean.reset({});
  await clean.execute(cleanReset.runId, {
    capability: 'order.create', as: 'customer', arguments: { items: [{ dishName: '拿铁', count: 2 }] },
  });
  const expected = await clean.observe(cleanReset.runId, ['orders']);

  assert.equal(seen.state.orders[0].totalAmount, expected.state.orders[0].totalAmount + 1, '差一算子应当只改这一个数');
  assert.equal(seen.state.orders[0].status, expected.state.orders[0].status, '别的字段不该动');
});

test('breed：不跑案例只看得到静态表，跑了案例才看得到做出来的订单', async () => {
  const bare = await breedMutants({ adapter: createMemoryAdapter(), out: OUT + '/bare', max: 200 });
  assert.ok(bare.written > 0);
  assert.equal(bare.items.some((p) => p.target.collection === 'orders'), false, '没跑案例时不该有 orders');

  const caseObj = JSON.parse(fs.readFileSync('cases/coffee/happy-path.json', 'utf8'));
  const played = await breedMutants({ adapter: createMemoryAdapter(), out: OUT + '/played', max: 200, caseObj });
  assert.ok(played.items.some((p) => p.target.collection === 'orders'), '跑完案例后应看得到 orders');
});

test('breed：写出去的目录能被 loadBredMutants 读回来，形状与内置一致', async () => {
  fs.rmSync(OUT + '/roundtrip', { recursive: true, force: true });
  const report = await breedMutants({
    adapter: createMemoryAdapter(), out: OUT + '/roundtrip', max: 6,
    caseObj: JSON.parse(fs.readFileSync('cases/coffee/happy-path.json', 'utf8')),
  });
  const back = await loadBredMutants(OUT + '/roundtrip');
  assert.equal(back.length, report.written);
  for (const m of back) {
    assert.equal(typeof m.wrap, 'function');
    assert.equal(m.layer, 'state');
    assert.ok(m.title && m.symptom && m.mechanism && m.catch_hint);
  }
});

test('breed：限定集合时只在那几个集合里造故障', async () => {
  const report = await breedMutants({
    adapter: createMemoryAdapter(), out: OUT + '/scoped', max: 200, collections: ['orders'],
    caseObj: JSON.parse(fs.readFileSync('cases/coffee/happy-path.json', 'utf8')),
  });
  assert.ok(report.items.every((p) => p.target.collection === 'orders'));
});

test('breed：没有状态时如实说没东西可造，不编', async () => {
  const empty = { async reset() { return { runId: 'r' }; }, async observe() { return { state: null }; } };
  const report = await breedMutants({ adapter: empty, out: OUT + '/empty' });
  assert.equal(report.written, 0);
  assert.match(report.reason, /观测不到/);
});

test.after(() => { fs.rmSync(OUT, { recursive: true, force: true }); });

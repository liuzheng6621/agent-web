import test from 'node:test';
import assert from 'node:assert/strict';
import { planMutants, renderMutant, collectLeaves } from '../src/breed.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';

const STATE = {
  orders: [
    { id: 1, status: 'PENDING', totalAmount: 56, items: [{ dishName: '拿铁', count: 2, unitPrice: 28, subTotal: 56 }] },
    { id: 2, status: 'PICKED', totalAmount: 22, items: [{ dishName: '美式', count: 1, unitPrice: 22, subTotal: 22 }] },
  ],
  menu: [
    { id: 'latte', dishName: '拿铁', price: 28 },
    { id: 'americano', dishName: '美式', price: 22 },
  ],
  status_log: [
    { id: 1, type: 'order.created', orderId: 1, from: null, to: 'PENDING' },
    { id: 2, type: 'order.making', orderId: 1, from: 'PENDING', to: 'MAKING' },
  ],
};

test('算子表：数值四个、字符串五个、集合级五个', () => {
  const leaves = collectLeaves(STATE, { collections: ['orders', 'menu'] });
  const numbers = leaves.filter((l) => l.kind === 'number').length;
  const plan = planMutants(STATE, { collections: ['orders', 'menu'], max: 999 });
  const perNumber = plan.filter((p) => p.target.kind === 'number').length / Math.max(numbers, 1);
  assert.equal(perNumber, 4, '数值算子应该是 4 个（差一/翻倍/丢分/归零）');
  const menuOps = plan.filter((p) => p.target.kind === 'collection' && p.target.collection === 'menu');
  assert.equal(menuOps.length, 5, '集合级算子应该是 5 个');
});

test('归零：symptom 必须写「变成 0」，不能写回原值', () => {
  const plan = planMutants(STATE, { collections: ['orders'], max: 999 });
  const zero = plan.find((p) => p.op.name === 'zero' && p.target.path === 'totalAmount');
  assert.ok(zero, '应当生成归零变异体');
  const src = renderMutant(zero);
  assert.match(src, /从 56 变成 0/, 'symptom 文案必须反映算子的真实效果');
  assert.match(src, /setPath\(entity, "totalAmount", 0\)/);
});

test('截尾：symptom 写出截掉末字符后的值', () => {
  const plan = planMutants(STATE, { collections: ['orders'], max: 999 });
  const tr = plan.find((p) => p.op.name === 'truncate' && p.target.path === 'status');
  const src = renderMutant(tr);
  // 生成的是源码文本，引号在字符串字面量里是转义过的
  assert.match(src, /从 \\"PENDING\\" 变成 \\"PENDIN\\"/, 'symptom 要真的算出截尾结果');
});

test('集合级算子各有自己的 body，不会都落到 reverse 分支', () => {
  const plan = planMutants(STATE, { collections: ['menu'], max: 999 }).filter((p) => p.target.kind === 'collection');
  const bodies = plan.map((p) => renderMutant(p).split('async observe')[1]);
  const dropFirst = plan.find((p) => p.op.name === 'drop-first');
  const dupFirst = plan.find((p) => p.op.name === 'duplicate-first');
  const nulls = plan.find((p) => p.op.name === 'null-fields');
  assert.match(renderMutant(dropFirst), /arr\.shift\(\)/);
  assert.match(renderMutant(dupFirst), /arr\.push\(clone\(arr\[0\]\)\)/);
  assert.match(renderMutant(nulls), /row\[k\] = null/);
  assert.equal(new Set(bodies).size, bodies.length, '五个集合级算子应当产出五段不同的 body');
});

test('恒等算子不进计划：归零不作用于已经是 0 的值', () => {
  const zeroState = { orders: [{ id: 1, status: 'PENDING', totalAmount: 0, items: [] }] };
  const plan = planMutants(zeroState, { collections: ['orders'], max: 999 });
  assert.ok(!plan.some((p) => p.op.name === 'zero' && p.target.path === 'totalAmount'), '0 归零还是 0，是等价变异体');
});

test('生成的变异体自包含：不 import 任何模块', () => {
  const plan = planMutants(STATE, { collections: ['orders'], max: 999 });
  for (const p of plan.slice(0, 6)) {
    const src = renderMutant(p);
    assert.ok(!/^import /m.test(src), `${p.id} 不该有 import，拷到哪都要能跑`);
    assert.match(src, /export function wrap\(adapter\)/);
  }
});

test('生成的变异体在正确实现上能加载且不炸', async () => {
  const plan = planMutants(STATE, { collections: ['menu'], max: 999 });
  const src = renderMutant(plan.find((p) => p.op.name === 'null-fields'));
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
  const mod = await import(dataUrl);
  const wrapped = mod.wrap(createMemoryAdapter());
  const r = await wrapped.reset();
  const o = await wrapped.observe(r.runId);
  assert.ok(Array.isArray(o.state.menu));
  assert.equal(o.state.menu[0].dishName, null, 'null-fields 应当把字段清成 null');
});

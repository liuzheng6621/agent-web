import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appliesTo, certifyExit, formatCertify, transformCtxProbe } from '../src/certify.mjs';
import { mutants } from '../docs/mutants/index.mjs';
import { renderMutant } from '../src/breed.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---------- 1. 目录里每一个变异体都得说清「我对哪些域有意义」 ----------

test('每个变异体都声明了 applies_to —— 省略等于「对所有域适用」，那是把分母撑大的默认值', () => {
  const missing = mutants.filter((m) => !m.applies_to).map((m) => m.id);
  assert.deepEqual(missing, [], `这些变异体没写 applies_to：${missing.join(' ')}`);
});

test('applies_to 不是摆设：同一批变异体在不相干的域上必须判「不适用」', () => {
  const coffee = { capabilities: [{ id: 'order.create' }], scopes: ['menu', 'orders', 'status_log'] };
  const ledger = { capabilities: [{ id: 'transaction.post' }], scopes: ['accounts', 'transactions', 'trial'] };
  // 账本域特有的东西，在咖啡域上不该被算进分母
  const ledgerOnly = mutants.filter((m) => m.id.startsWith('m-ledger-') || m.id.startsWith('m-dup-') || m.id.startsWith('m-unbalanced-'));
  assert.ok(ledgerOnly.length >= 4, `账本变异体不该少于 4 个（当前 ${ledgerOnly.length}）`);
  for (const m of ledgerOnly) {
    assert.equal(appliesTo(m, coffee), false, `${m.id} 在咖啡域也判适用：声明太宽`);
    assert.equal(appliesTo(m, ledger), true, `${m.id} 在自己的域上判不适用：等于没写`);
  }
});

// ---------- 2. breed 生成器必须把目标集合写进去 ----------

test('breed 生成的变异体自带 applies_to，而且指向它改的那个集合', () => {
  const item = {
    id: 'm-breed-zero-orders-0-totalamount',
    op: { name: 'zero', apply: '0', symptom: '数字变成 0', mechanism: '把这个数值置为 0', rewrites: '归零' },
    target: { collection: 'orders', index: 0, path: 'totalAmount', kind: 'number', value: 122 },
    layer: 'state',
  };
  const src = renderMutant(item);
  assert.match(src, /applies_to:\s*\{\s*collections:\s*\["orders"\]\s*\}/,
    'breed 模板没写 applies_to：每跑一次 breed 就往每个新域的分母里灌一批造不出差异的变异体');
  // 集合级算子走另一条分支，同样要带
  const coll = renderMutant({
    id: 'm-breed-drop-first-menu',
    op: { name: 'drop-first', apply: '', symptom: '少一条', mechanism: '丢头', rewrites: '丢头' },
    target: { collection: 'menu', index: null, path: null, kind: 'collection', length: 3 },
    layer: 'state',
  });
  assert.match(coll, /applies_to:\s*\{\s*collections:\s*\["menu"\]\s*\}/);
});

// ---------- 3. 环境没起来时不许把 0 当成绩 ----------

function unusableReport(extra = {}) {
  return {
    version: 'agent-web/certify-1',
    adapter: 'ghost',
    cases: [{ caseId: 'x/one', verdict: 'unknown', traceOk: false }],
    assertions: [],
    mutations: [
      { id: 'm-a', title: 'a', layer: 'state', symptom: 's', caught: false, status: 'undetermined',
        killedBy: [], blindBy: [], survivedIn: [], verdictKills: 0, witnessCount: 0,
        suggestionBlocked: false, witness: null, suggestion: null, suggestionCount: 0, equivalence: null },
    ],
    summary: {
      cases: 1, mutations: 1, applicable: 1, notApplicable: 0, caught: 0, survived: 1,
      killable: 0, undetermined: 1, suggestions: 0, caughtRate: null,
      unusableCases: ['x/one'], allUnusable: true, ...extra,
    },
    minimal: { assertions: [], uncovered: ['m-a'] },
  };
}

test('一条案例都没跑起来时：退出码是 2（环境错误），不是 0（查过了没问题）', () => {
  assert.equal(certifyExit(unusableReport()), 2,
    '环境故障退 0 等于告诉 CI「查过了」，而实际什么都没查');
  // 跑起来了、只是有漏网 —— 那才是 1
  const ran = unusableReport({ allUnusable: false, unusableCases: [], caughtRate: 0, survived: 1 });
  assert.equal(certifyExit(ran), 1);
});

test('全不可用时的输出必须先说「这一跑不成立」，不能先报一个 0.0% 的抓获率', () => {
  const out = formatCertify(unusableReport());
  assert.match(out, /这一跑不成立/);
  assert.ok(!/变异体抓获率/.test(out),
    '环境没起来还印抓获率，读者只会看到 0.0% 并以为断言不够狠');
});

test('部分案例不可用时：照常报率，但要点名是哪几条没跑起来', () => {
  const partial = unusableReport({
    allUnusable: false, unusableCases: ['x/two'], caughtRate: 0.5, caught: 1, survived: 1,
  });
  partial.mutations = [
    { id: 'm-a', title: 'a', layer: 'state', symptom: 's', caught: true, status: 'caught',
      killedBy: [{ caseId: 'x/one', assertion: 'x/one#goal[0]', kind: 'field_equals' }], blindBy: [], survivedIn: [],
      verdictKills: 0, witnessCount: 0, suggestionBlocked: false, witness: null, suggestion: null, suggestionCount: 0, equivalence: null },
  ];
  const out = formatCertify(partial);
  assert.match(out, /变异体抓获率 1\/1/);
  assert.match(out, /x\/two/, '没说清哪几条没跑起来，读者会以为所有案例都验过了');
});

// ---------- 4. 变换快路径遇到「没有状态」不许崩 ----------

test('ctx.initial / ctx.final 是 undefined 时，变换不抛错（那是环境没起来，不是变异体写错了）', () => {
  const ctx = { initial: undefined, final: undefined, trace: [] };
  const tamper = (state) => { state.orders = []; };
  assert.doesNotThrow(() => transformCtxProbe(ctx, tamper),
    '快路径拿 undefined 去变换会 TypeError，整个 certify 当场崩掉，报出来的是「Cannot read properties of undefined」而不是「环境没起来」');
});

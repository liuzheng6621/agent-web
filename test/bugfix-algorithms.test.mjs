/**
 * 算法审查回归测试（v0.75.0 批次）。
 * 每条对应一处实修：修的是「会产出错误判决/白烧资源」的洞，不是风格。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { getPath } from '../src/values.mjs';
import { evalShape } from '../src/assert/shape.mjs';
import { validateAssertion } from '../src/assert/index.mjs';
import { recurrence } from '../src/assert/recurrence.mjs';
import { timeliness } from '../src/assert/timeliness.mjs';
import { linkage } from '../src/assert/linkage.mjs';

test('F1 getPath：对象自有 length 属性不再被数组特例遮蔽', () => {
  assert.equal(getPath({ length: 5 }, 'length'), 5);
  assert.equal(getPath({ a: { length: 'x' } }, 'a.length'), 'x');
  // 数组/字符串语义不回归
  assert.equal(getPath([10, 20], 'length'), 2);
  assert.equal(getPath('abc', 'length'), 3);
  assert.equal(getPath([10, 20], '1'), 20);
  assert.equal(getPath({ a: ['x'] }, 'a.0'), 'x');
});

test('F2 sorted_by：混合类型判 unknown，不静默强转', () => {
  const mixed = { final: { rows: [{ t: 28 }, { t: '5' }] } };
  const r = evalShape({ kind: 'sorted_by', selector: { collection: 'rows' }, path: 't' }, mixed);
  assert.equal(r.status, 'unknown');
  assert.equal(r.code, 'invalid_case');
  // 双 number / 双 string 不回归
  const nums = { final: { rows: [{ t: 1 }, { t: 2 }] } };
  assert.equal(evalShape({ kind: 'sorted_by', selector: { collection: 'rows' }, path: 't' }, nums).status, 'true');
  const strs = { final: { rows: [{ t: 'a' }, { t: 'b' }] } };
  assert.equal(evalShape({ kind: 'sorted_by', selector: { collection: 'rows' }, path: 't' }, strs).status, 'true');
  const reversed = { final: { rows: [{ t: 'b' }, { t: 'a' }] } };
  assert.equal(evalShape({ kind: 'sorted_by', selector: { collection: 'rows' }, path: 't' }, reversed).status, 'false');
});

test('F3 unique/subset：对象值按稳定序列化比较，不塌缩成 [object Object]', () => {
  const twoObjects = { final: { rows: [{ v: { a: 1 } }, { v: { b: 2 } }] } };
  const r = evalShape({ kind: 'unique', selector: { collection: 'rows' }, path: 'v' }, twoObjects);
  assert.equal(r.status, 'true', '两个不同对象不是重复');
  const dup = { final: { rows: [{ v: { a: 1 } }, { v: { a: 1 } }] } };
  assert.equal(evalShape({ kind: 'unique', selector: { collection: 'rows' }, path: 'v' }, dup).status, 'false');
  const one = { final: { rows: [{ v: { a: 1 } }] } };
  const ok = evalShape({ kind: 'subset', selector: { collection: 'rows' }, path: 'v', values: [{ a: 1 }] }, one);
  assert.equal(ok.status, 'true');
  const bad = evalShape({ kind: 'subset', selector: { collection: 'rows' }, path: 'v', values: [{ a: 2 }] }, one);
  assert.equal(bad.status, 'false');
  // 原始值口径不回归
  const prim = { final: { rows: [{ v: 'credit' }, { v: 'debit' }] } };
  assert.equal(evalShape({ kind: 'unique', selector: { collection: 'rows' }, path: 'v' }, prim).status, 'true');
});

test('F4 relation.sum_by_equals：缺字段在校验期报错，不等到运行时', () => {
  const errs = validateAssertion({ kind: 'relation', op: 'sum_by_equals', selector: { collection: 'entries' } });
  assert.equal(errs.length, 4, errs.join(' | '));
  const ok = validateAssertion({
    kind: 'relation', op: 'sum_by_equals', selector: { collection: 'entries' },
    field: 'amount', group_field: 'side', left: 'debit', right: 'credit',
  });
  assert.deepEqual(ok, []);
});

test('F5 recurrence：容差内的末槽准点行不被边界丢弃', () => {
  const ctx = {
    final: { runs: [{ scheduledFor: 0 }, { scheduledFor: 1000 }, { scheduledFor: 2600 }] },
  };
  const a = {
    every: '1s', from: 0, to: 2000, timezone: 'UTC', tolerance_ms: 600,
  };
  const r = recurrence(a, ctx);
  assert.equal(r.status, 'true', r.message + ' ← 行在 (to, to+tol] 内被丢成了漏跑');
  // 对照：tol < every/2 时同样这行仍然是漂移（越界一格以上）
  const r2 = recurrence({ ...a, tolerance_ms: 100 }, ctx);
  assert.equal(r2.status, 'false');
});

test('F6 timeliness：显式 value:null 是合法匹配条件', () => {
  const ctx = {
    final: {
      status_log: [
        { type: 'order.system', op: null, at: 1000 },
        { type: 'order.pick', op: 'user', at: 2000 },
      ],
    },
  };
  const r = timeliness(
    { from: { type: 'order.system', field: 'op', value: null }, to: { type: 'order.pick' }, max: '1h', timezone: 'UTC' },
    ctx,
  );
  assert.equal(r.status, 'true', r.message);
  // 没有任何行满足 value:null 时应报 missing_observation（起点找不到），而不是误配到 op:'user' 行
  const r2 = timeliness(
    { from: { type: 'order.pick', field: 'op', value: null }, to: { type: 'order.pick' }, max: '1h', timezone: 'UTC' },
    ctx,
  );
  assert.equal(r2.status, 'unknown');
  assert.equal(r2.code, 'missing_observation');
});

test('F7 linkage：索引化后行为等价（命中/缺失/计数）', () => {
  const base = (fromRows, toRows, extra = {}) => ({
    final: { orders: fromRows, events: toRows },
  });
  const a = (over = {}) => ({
    from: { collection: 'orders' },
    to: { collection: 'events', on: { from_field: 'id', to_field: 'order_id' } },
    expect: { op: 'equals', field: 'kind', value: 'created' },
    ...over,
  });
  const hit = linkage(a(), base([{ id: 1 }], [{ order_id: 1, kind: 'created' }]));
  assert.equal(hit.status, 'true');
  const miss = linkage(a(), base([{ id: 2 }], [{ order_id: 1, kind: 'created' }]));
  assert.equal(miss.status, 'false');
  assert.equal(miss.code, 'linkage_missing');
  const count = linkage(
    a({ expect: { count: 2, count_op: 'equals' } }),
    base([{ id: 1 }], [{ order_id: 1 }, { order_id: 1 }]),
  );
  assert.equal(count.status, 'true');
});

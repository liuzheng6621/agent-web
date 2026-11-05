import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectionsOf } from '../src/breed.mjs';
import { mutationIds } from '../src/mutate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('集合名从 manifest 取，读不到才退回默认', () => {
  assert.deepEqual(collectionsOf({ view: { collections: { articles: {}, tags: {} } } }), ['articles', 'tags']);
  assert.equal(collectionsOf({ view: {} }), null);
  assert.equal(collectionsOf({}), null);
  assert.equal(collectionsOf(null), null);
});

test('执行层三条变异体都在目录里，且各自只有 execute 包装', async () => {
  const ids = mutationIds();
  for (const id of ['m-exec-role-ignore', 'm-exec-duplicate-write', 'm-exec-drop-intermediate']) {
    assert.ok(ids.includes(id), id + ' 没进目录');
    const mod = await import(pathToFileURL(path.join(ROOT, 'docs/mutants', id + '.mjs')).href);
    assert.equal(mod.meta.layer, 'execute');
    assert.equal(typeof mod.wrap, 'function');
  }
});

test('执行层变异体不改观测：包一层之后 observe 还是原来那个', async () => {
  const { mutate } = await import('../src/mutate.mjs');
  const fake = {
    manifest: () => ({ roles: ['admin', 'staff', 'customer'], view: { collections: { orders: {} } } }),
    async observe() { return { state: { orders: [] } }; },
    async execute(id, a) { return { outcome: 'applied', as: a.as }; },
    async reset() { return { runId: 'r', roleBindings: {}, state: {} }; },
    async close() {},
  };
  for (const id of ['m-exec-role-ignore', 'm-exec-duplicate-write', 'm-exec-drop-intermediate']) {
    const wrapped = mutate(fake, id);
    const res = await wrapped.observe('r');
    assert.deepEqual(res, { state: { orders: [] } }, id + ' 不该动观测');
  }
});

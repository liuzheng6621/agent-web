import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge } from '../src/runner.mjs';
import { certify } from '../src/certify.mjs';
import { createAnimalMemoryAdapter, validateAnimalMemoryAdapter } from '../examples/animal-tracking/memory-adapter.mjs';
import { missedRewardMutation } from '../examples/animal-tracking/business-mutants.mjs';
import { createAnimalTrackingAdapter } from '../examples/animal-tracking/adapter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const animalCase = JSON.parse(fs.readFileSync(path.join(here, '../examples/animal-tracking/task-lifecycle.json'), 'utf8'));

test('animal task lifecycle case passes and checks rejected actions', async () => {
  assert.deepEqual(validateAnimalMemoryAdapter(), []);
  const verdict = await judge({ case: animalCase, adapter: createAnimalMemoryAdapter(), adapterName: 'animal-tracking-memory' });
  assert.equal(verdict.status, 'pass', verdict.detail);
  assert.deepEqual(verdict.evidence.trace.map((step) => step.outcome), [
    'applied', 'rejected', 'applied', 'applied', 'rejected', 'applied', 'rejected',
  ]);
  assert.deepEqual(verdict.evidence.final.tasks.map((task) => task.status), ['COMPLETED']);
  assert.equal(verdict.evidence.final.points[0].points, 25);
});

test('animal reward assertion catches a task-completion reward mutant', async () => {
  const report = await certify({
    cases: [animalCase],
    adapterFactory: createAnimalMemoryAdapter,
    adapterName: 'animal-tracking-memory',
    mutations: [missedRewardMutation],
  });
  assert.equal(report.cases[0].verdict, 'pass');
  assert.equal(report.mutations[0].caught, true);
  assert.ok(report.mutations[0].killedBy.some((row) => row.kind === 'field_equals' && row.assertion.endsWith('goal[8]')));
});

test('real animal adapter rejects public hosts and requires isolation opt-in', () => {
  assert.throws(
    () => createAnimalTrackingAdapter({ baseUrl: 'https://example.com', isolated: true, adminUsername: 'admin', adminPassword: 'x' }),
    /loopback/,
  );
  assert.throws(
    () => createAnimalTrackingAdapter({ baseUrl: 'http://127.0.0.1:18080', isolated: false, adminUsername: 'admin', adminPassword: 'x' }),
    /ANIMAL_TEST_ISOLATED=1/,
  );
});

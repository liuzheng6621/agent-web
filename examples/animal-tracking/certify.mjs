import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { certify, certifyExit, formatCertify } from '../../src/certify.mjs';
import { createAnimalMemoryAdapter } from './memory-adapter.mjs';
import { missedRewardMutation } from './business-mutants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const caseFile = path.join(here, 'task-lifecycle.json');
const caseObj = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
const report = await certify({
  cases: [caseObj],
  adapterFactory: createAnimalMemoryAdapter,
  adapterName: 'animal-tracking-memory',
  mutations: [missedRewardMutation],
});

console.log(formatCertify(report, { detail: true }));
if (report.cases.some((item) => item.verdict !== 'pass') || !report.mutations[0]?.caught) {
  process.exitCode = 1;
}
if (certifyExit(report) !== 0) process.exitCode = 1;

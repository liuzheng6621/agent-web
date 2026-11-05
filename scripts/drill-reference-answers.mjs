#!/usr/bin/env node
// 生成 drill 的参考答案：每道题取一条「已验过能杀掉该变异体」的建议断言。
// 只写被两个实现当场验过的断言（正确实现 true、坏实现 false），不猜。
//
// 用法：node scripts/drill-reference-answers.mjs [--out=examples/drills/good] [--cases=cases/coffee]
import fs from 'node:fs';
import path from 'node:path';
import { certifyCase } from '../src/certify.mjs';
import { loadAdapter } from '../src/adapter/load.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const outDir = arg('out', 'examples/drills/good');
const casesDir = arg('cases', 'cases/coffee');
const tasks = arg('tasks', null);
const NL = String.fromCharCode(10);

const cases = fs.readdirSync(casesDir)
  .filter((n) => n.endsWith('.json') && n !== 'expected.json')
  .map((n) => JSON.parse(fs.readFileSync(path.join(casesDir, n), 'utf8')))
  .filter((c) => c && c.id);

let written = 0;
const taskSet = tasks
  ? new Set((fs.existsSync(tasks) ? fs.readdirSync(tasks) : []).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)))
  : null;
const NL2 = String.fromCharCode(10);
for (const c of cases) {
  const cr = await certifyCase(c, () => loadAdapter('memory'), { adapterName: 'memory' });
  for (const row of cr.rows) {
    if (row.notApplicable) continue;
    for (const sug of row.suggestions || []) {
      if (!(sug.proof && sug.proof.kills) || !sug.assertion) continue;
      const name = String(c.id).split('/').join('__') + '-at-' + row.mutation + '.json';
      if (tasks && !taskSet.has(name.slice(0, -5))) continue;
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, name), JSON.stringify({ assertions: [sug.assertion] }, null, 2) + NL2);
      written += 1;
      break;
    }
  }
}
console.log('写出 ' + written + ' 份参考答案 -> ' + outDir);


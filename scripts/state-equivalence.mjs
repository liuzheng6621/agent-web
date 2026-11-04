#!/usr/bin/env node
// 快路径与重放路径必须给出同一个答案。
//
// state 层变异体只改观测，所以 certify 可以用「P⁺ 的 ctx + 同一个 tamper」代替
// 「reset + 重放整条轨迹 + 逐次 observe」。这是一条优化，不是一个假设：
// 这个脚本逐案例、逐变异体对比两条路径，任何一格不同就退出 1。
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { probe, fastProbe } from '../src/certify.mjs';
import { mutants } from '../docs/mutants/index.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';
import { stableStringify } from '../src/values.mjs';

const dir = process.argv[2] ?? 'cases/coffee';
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'expected.json').sort();

const bad = [];
const noTamper = [];
let compared = 0;
let reused = 0;

for (const file of files) {
  const caseObj = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  const base = await probe(caseObj, createMemoryAdapter(), { adapterName: 'memory' });
  const canReuse = !(base.verdict?.status === 'unknown' && base.verdict?.reason_code === 'missing_observation');

  for (const m of mutants) {
    if (m.layer !== 'state') continue;
    const wrapped = m.wrap(createMemoryAdapter());
    const tamper = wrapped._agentWebStateFn;
    if (typeof tamper !== 'function') {
      noTamper.push(m.id);
      continue;
    }
    const slow = await probe(caseObj, wrapped, { adapterName: 'memory' });
    const fast = fastProbe(caseObj, base, tamper);
    compared += 1;
    if (canReuse) reused += 1;

    const slowCells = slow.results.map((r) => r.status).join(',');
    const fastCells = fast.results.map((r) => r.status).join(',');
    if (slowCells !== fastCells) {
      bad.push(file + ' ' + m.id + ' 断言结果不同：重放[' + slowCells + '] 变换[' + fastCells + ']');
    }
    const slowSig = String(slow.verdict?.status) + '/' + String(slow.verdict?.reason_code);
    const fastSig = String(fast.verdict?.status) + '/' + String(fast.verdict?.reason_code);
    if (slowSig !== fastSig) {
      bad.push(file + ' ' + m.id + ' 判决不同：重放 ' + slowSig + ' 变换 ' + fastSig);
    }
    if (stableStringify(slow.ctx.final) !== stableStringify(fast.ctx.final)) {
      bad.push(file + ' ' + m.id + ' 终态规范视图不同');
    }
    if (stableStringify(slow.ctx.initial) !== stableStringify(fast.ctx.initial)) {
      bad.push(file + ' ' + m.id + ' 初态规范视图不同');
    }
  }
}

if (noTamper.length) {
  console.log('没有声明 tamper 的 state 变异体（会退回重放）：' + noTamper.join(', '));
}
console.log('对比 ' + compared + ' 组（其中 ' + reused + ' 组会走快路径），不一致 ' + bad.length + ' 处。');
for (const line of bad.slice(0, 12)) console.log('  ! ' + line);
if (bad.length) process.exit(1);
console.log('快路径与重放逐格相同。');

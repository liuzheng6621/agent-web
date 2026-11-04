/**
 * 这个脚本测的不是被测系统，是 certify 自己。
 *
 * 把所有和总价有关的断言摘掉（写死总价的 field_equals，以及拿总价对账的 relation），
 * 再跑一遍判据准入：
 *   - 必须出现漏网的变异体（否则 certify 只会说"全抓到"，等于装饰）
 *   - 漏网的必须包含金额那个
 *
 * 2026-11 改：原先只摘 happy-path 里那一条写死总价的断言，后来加了关系式断言
 * （totalAmount == Σ items.subTotal），它把金额变异体接住了，脚本于是永远绿。
 * 这说明脚本自己也可能是装饰 —— 摘不干净就等于没测。
 * 一个从不判红的检查器，和一个永远绿的告警邮件是同一种东西。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { certify, certifyExit } from '../src/certify.mjs';
import { createMemoryAdapter } from '../src/adapter/memory.mjs';

const DIR = 'cases/coffee';
const cases = readdirSync(DIR)
  .filter((f) => f.endsWith('.json') && f !== 'expected.json')
  .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')));

const target = cases.find((c) => c.id === 'coffee/happy-path');
if (!target) {
  console.error('找不到 coffee/happy-path，脚本的假设已经过期');
  process.exit(1);
}

const touchesTotal = (a) => a.path === 'totalAmount' || (Array.isArray(a.scopes) && a.scopes.includes('totalAmount'));
let removed = 0;
for (const c of cases) {
  const list = c?.task?.goal_assertions;
  if (!Array.isArray(list)) continue;
  const kept = list.filter((a) => !touchesTotal(a));
  removed += list.length - kept.length;
  c.task.goal_assertions = kept;
}
if (removed === 0) {
  console.error('案例集里没有和总价有关的断言可摘，这个脚本再也证明不了 certify 会判红');
  process.exit(1);
}

const report = await certify({ cases, adapterFactory: () => createMemoryAdapter(), adapterName: 'memory' });
const survived = report.mutations.filter((m) => !m.caught).map((m) => m.id);

if (survived.length === 0) {
  console.error('摘掉金额断言后仍然"全抓到"—— certify 不会判红，它是装饰');
  process.exit(1);
}
if (!survived.includes('m-money-off-by-cent')) {
  console.error(`漏网的应包含金额变异体，实际 ${survived.join(',')}`);
  process.exit(1);
}
if (certifyExit(report) !== 1) {
  console.error('有漏网变异体却没返回 1');
  process.exit(1);
}

const dead = report.assertions.filter((a) => !a.unarmed && a.kills.length === 0);
console.log(
  `certify 会判红：摘掉 ${removed} 条总价断言（含关系式）后漏网 ${survived.length} 个` +
    `（${survived.join(', ')}），空转断言 ${dead.length} 条`,
);

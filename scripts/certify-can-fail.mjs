/**
 * 这个脚本测的不是被测系统，是 certify 自己。
 *
 * 把金额断言从 happy-path 里摘掉，再跑一遍判据准入：
 *   - 必须出现漏网的变异体（否则 certify 只会说"全抓到"，等于装饰）
 *   - 漏网的必须正好是金额那个
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

const before = target.task.goal_assertions.length;
target.task.goal_assertions = target.task.goal_assertions.filter((a) => a.path !== 'totalAmount');
if (target.task.goal_assertions.length === before) {
  console.error('happy-path 里没有金额断言可摘，这个脚本再也证明不了 certify 会判红');
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
console.log(`certify 会判红：摘掉金额断言后漏网 ${survived.length} 个（${survived.join(', ')}），空转断言 ${dead.length} 条`);

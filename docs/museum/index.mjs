/** 展品注册表。展品自己也要被 CI 验证，否则这个目录明天就变成墓地。 */
import * as e01 from './e01-identity-collapse.mjs';
import * as e02 from './e02-event-vocabulary.mjs';
import * as e03 from './e03-draft-gate.mjs';
import * as e04 from './e04-precondition-false.mjs';
import * as e05 from './e05-hanging-adapter.mjs';
import * as e06 from './e06-role-collapse.mjs';
import * as e07 from './e07-contract-violation.mjs';
import * as e08 from './e08-second-place.mjs';

export const exhibits = [e01, e02, e03, e04, e05, e06, e07, e08];

export async function runAll() {
  const out = [];
  for (const m of exhibits) {
    const r = await m.run();
    out.push({ meta: m.meta, result: r });
  }
  return out;
}

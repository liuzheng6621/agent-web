/**
 * 展品 01 · 身份塌缩
 *
 * 症状：同一个案例，在内存实现上判 fail，在真后端上判 pass。两个判决都是绿的或红的，
 *       但只有一个是关于「案例声称的那件事」。
 *
 * 为什么三值逻辑抓不到：三值只处理「不知道」（观测不到、能力没有、事件没记全）。
 *       这里观测一切正常、断言也真的成立——只是被执行的人被悄悄换成了别人。
 *       一个错误的测量对象，会给出一个完全正确的判决。
 *
 * 谁抓住的：compare（跨实现判决对照）。同一个案例、两个实现、判决必须一致；
 *       不一致就说明至少有一边的测量对象不对。
 */
import { readFileSync } from 'node:fs';
import { createMemoryAdapter } from '../../src/adapter/memory.mjs';
import { judge } from '../../src/runner.mjs';

export const meta = {
  id: 'e01',
  title: '身份塌缩：按角色选令牌，而不是按案例声明的 as',
  symptom: 'foreign-pickup 在塌缩版适配器上判 pass（真身为下单人本人执行），在诚实实现上判 fail',
  mechanism: 'compare · 跨实现判决对照',
  naive: 'pass',
  caught: 'fail',
  caughtCode: 'unexpected_rejection',
};

function collapsed(inner) {
  return {
    manifest: () => inner.manifest(),
    reset: (o) => inner.reset(o),
    observe: (r, s) => inner.observe(r, s),
    close: (r) => inner.close(r),
    // 只塌缩「两位顾客」这一条线：把 customer2 悄悄换成 customer，
    // 店员线照旧——真实事故里塌缩的正是这种「按角色分线路」的写法。
    execute: (r, a) => inner.execute(r, { ...a, as: a.as === 'customer2' ? 'customer' : a.as }),
  };
}

export async function run() {
  const url = new URL('../../cases/coffee/foreign-pickup.json', import.meta.url);
  const c = JSON.parse(readFileSync(url, 'utf8'));
  const honest = await judge({ case: c, adapter: createMemoryAdapter(), adapterName: 'memory' });
  const buggy = await judge({ case: c, adapter: collapsed(createMemoryAdapter()), adapterName: 'collapsed' });
  return {
    naive: { status: buggy.status, reason_code: buggy.reason_code },
    caught: { status: honest.status, reason_code: honest.reason_code },
    disagreement: honest.status !== buggy.status,
  };
}

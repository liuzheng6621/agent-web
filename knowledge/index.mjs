// 事故档案：这个仓库自己踩过的坑。
//
// 入库宪法（和 certify 同一条）：
//   给不出复现、给不出判据的错误，不许入库。
//
// 也就是说，这里每一条都必须同时具备两样东西：
//   1. 一个能跑的最小复现（repro）—— 证明它真的发生过，不是听说
//   2. 一个已经落地的判据（guard）—— 证明下次它再发生时有人喊
//
// 只有一样的不收。两样都没有的，那是段子，不是档案。

import { e01 } from './k01-identity-collapse.mjs';
import { e02 } from './k02-menu-not-aligned.mjs';
import { e03 } from './k03-unportable-assertion.mjs';
import { e04 } from './k04-parallel-verdict-drift.mjs';
import { e05 } from './k05-gitignore-swallows-examples.mjs';
import { e06 } from './k06-severity-as-status.mjs';
import { e07 } from './k07-test-not-in-script.mjs';
import { e08 } from './k08-truthy-instead-of-true.mjs';
import { e09 } from './k09-out-dir-assumed.mjs';
import { e10 } from './k10-case-without-expectation.mjs';
import { e11 } from './k11-version-tri-truth.mjs';
import { e12 } from './k12-login-rate-limit.mjs';
import { e13 } from './k13-order-not-in-contract.mjs';
import { e14 } from './k14-tag-intermediate-state.mjs';
import { e15 } from './k15-ignored-flag.mjs';

export const KNOWLEDGE_VERSION = 'agent-web/knowledge-1';

export const ENTRIES = [e01, e02, e03, e04, e05, e06, e07, e08, e09, e10, e11, e12, e13, e14, e15];

export const GUARD_KINDS = ['probe', 'certify', 'ci', 'test', 'lint', 'none'];

const ID_RE = /^k-[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateEntry(e) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  need(e && typeof e === 'object', '条目不是对象');
  if (problems.length) return { ok: false, problems };
  need(ID_RE.test(e.id || ''), `id 不合 kebab-case：${e.id}`);
  need(typeof e.title === 'string' && e.title.length > 0, '缺 title');
  need(typeof e.symptom === 'string' && e.symptom.length > 0, '缺 symptom');
  need(typeof e.cause === 'string' && e.cause.length > 0, '缺 cause');
  need(typeof e.fix === 'string' && e.fix.length > 0, '缺 fix');
  need(e.fingerprint && typeof e.fingerprint === 'object', '缺 fingerprint');
  if (e.fingerprint) {
    need(typeof e.fingerprint.structure === 'string', '缺 fingerprint.structure');
    need(typeof e.fingerprint.witness === 'string', '缺 fingerprint.witness');
    need(typeof e.fingerprint.detector === 'string', '缺 fingerprint.detector');
  }
  need(e.first_seen && typeof e.first_seen === 'object', '缺 first_seen');
  if (e.first_seen) {
    need(typeof e.first_seen.commit === 'string', '缺 first_seen.commit（哪次提交引入的坏代码）');
    need(typeof e.first_seen.date === 'string', '缺 first_seen.date');
  }
  need(e.guard && GUARD_KINDS.includes(e.guard.kind), `guard.kind 必须是 ${GUARD_KINDS.join('/')}`);
  if (e.guard) {
    need(typeof e.guard.ref === 'string' && e.guard.ref.length > 0, '缺 guard.ref（判据落在哪个文件/检查项）');
  }
  // 宪法：没有判据的不许入库。
  need(e.guard && e.guard.kind !== 'none', '没有判据（guard.kind=none）—— 按宪法不许入库');
  need(typeof e.repro === 'string' && e.repro.length > 0, '缺 repro（最小复现，必须真的能跑）');
  return { ok: problems.length === 0, problems };
}

export function validateAll(entries = ENTRIES) {
  const problems = [];
  const seen = new Set();
  for (const e of entries) {
    const r = validateEntry(e);
    if (!r.ok) problems.push(`${e?.id || '(无 id)'}: ${r.problems.join('；')}`);
    if (e?.id) {
      if (seen.has(e.id)) problems.push(`重复 id：${e.id}`);
      seen.add(e.id);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function entryById(id) {
  return ENTRIES.find((e) => e.id === id) || null;
}

export function entriesByGuard(kind) {
  return ENTRIES.filter((e) => e.guard.kind === kind);
}

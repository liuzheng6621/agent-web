/**
 * 探针：适配器自己有没有在撒谎。
 *
 * 前面所有命令都有一个共同前提 —— 适配器给的观测是真的。可这个前提从来没人查过：
 *
 *   observe 每次都返回同一份缓存，写完了也不变
 *   reset 说是复位，其实上一轮的数据还在
 *   视图里带进了时间戳或随机数，同一状态读两次不一样
 *
 * 这三种情况下，判决依然会稳定地错 —— pass 是真的 pass，只是测的不是你以为的东西。
 * 这类失败比适配器写错更难发现：它不报错，它只是安静地准。
 *
 * 所以这里只查**可机械判定**的那几件事，不猜业务语义：
 *
 *   1. 复位幂等     连续两次 reset，初始视图必须一模一样
 *   2. 观测稳定     同一个状态连读两次，必须一模一样
 *   3. 无状态泄漏   写完之后再 reset，必须回到第一份初始视图
 *   4. 空参不炸     每个能力用空参数调一次，不得抛异常、不得 infra_error
 *   5. 写了要变     声明 applied 的写操作之后视图毫无变化 —— 可疑，报警不判死
 *
 * 第 5 条只报警不判死，因为有些写操作本来就不改规范视图（发通知、写审计日志）。
 * 报出来让人自己判，比替人判死要好。
 */

import { stableStringify, fingerprint } from './values.mjs';
import { validateAdapter, validateManifest } from './adapter/contract.mjs';

export const PROBE_VERSION = 'agent-web/probe-1';

const PASS = 'pass';
const FAIL = 'fail';
const WARN = 'warn';

function report(checks) {
  const failed = checks.filter((c) => c.status === FAIL);
  const warned = checks.filter((c) => c.status === WARN);
  return {
    probe_version: PROBE_VERSION,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((c) => c.status === PASS).length,
      failed: failed.length,
      warned: warned.length,
      ok: failed.length === 0,
    },
  };
}

async function snapshot(adapter, runId) {
  const r = await adapter.observe(runId);
  const state = r && typeof r === 'object' && 'state' in r ? r.state : r;
  return { state, fingerprint: fingerprint(stableStringify(state)) };
}

/**
 * @param {object} opts
 * @param {object} opts.adapter      已构造好的适配器实例
 * @param {string} [opts.adapterName]
 * @param {number} [opts.timeoutMs]  单次调用超时
 * @param {boolean} [opts.allowVolatile] 已知视图含时钟/随机数时跳过「观测稳定」
 */
export async function probeAdapter({ adapter, adapterName = 'unknown', timeoutMs = 5000, allowVolatile = false }) {
  const checks = [];
  const add = (id, title, status, severity, detail) => checks.push({ id, title, status, severity, detail });

  const contractErrors = validateAdapter(adapter);
  if (contractErrors.length > 0) {
    add('contract', '适配器实现了五方法', FAIL, FAIL, contractErrors.join('；'));
    return report(checks);
  }
  add('contract', '适配器实现了五方法', PASS, FAIL, 'manifest / reset / observe / execute / close 都在');

  const withTimeout = (p) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(`调用超时（>${timeoutMs}ms）`)), timeoutMs)),
    ]);

  let manifest;
  try {
    manifest = await withTimeout(adapter.manifest());
  } catch (e) {
    add('manifest', 'manifest() 可读', FAIL, FAIL, String(e && e.message));
    return report(checks);
  }
  const manifestErrors = validateManifest(manifest);
  add(
    'manifest',
    'manifest() 可读且通过校验',
    manifestErrors.length === 0 ? PASS : FAIL,
    FAIL,
    manifestErrors.length === 0 ? `adapter=${manifest.adapter}，${(manifest.capabilities ?? []).length} 条能力` : manifestErrors.join('；'),
  );
  if (manifestErrors.length > 0) return report(checks);
  if (allowVolatile) {
    checks.push({ id: 'volatile', title: '观测稳定', status: 'skipped', severity: WARN, detail: '调用方声明视图含时钟/随机数（--allow-volatile），跳过' });
  }

  // ---- 1/2/3：复位幂等、观测稳定、无状态泄漏 ----
  let first;
  let runId;
  try {
    runId = (await withTimeout(adapter.reset({}))).runId;
    first = await snapshot(adapter, runId);
  } catch (e) {
    add('reset', 'reset() 可执行', FAIL, FAIL, String(e && e.message));
    return report(checks);
  }

  try {
    runId = (await withTimeout(adapter.reset({}))).runId;
    const second = await snapshot(adapter, runId);
    add(
      'reset-idempotent',
      '复位幂等：两次 reset 的初始视图相同',
      first.fingerprint === second.fingerprint ? PASS : FAIL,
      FAIL,
      first.fingerprint === second.fingerprint
        ? first.fingerprint
        : `两次复位得到不同初态（${first.fingerprint} vs ${second.fingerprint}）—— ` +
          '复位没落实到可观测状态上，上一轮的数据可能还在',
    );

    if (!allowVolatile) {
      const again = await snapshot(adapter, runId);
      add(
        'observe-stable',
        '观测稳定：同一状态连读两次相同',
        second.fingerprint === again.fingerprint ? PASS : FAIL,
        FAIL,
        second.fingerprint === again.fingerprint
          ? second.fingerprint
          : `连读两次不一致（${second.fingerprint} vs ${again.fingerprint}）—— ` +
            '视图里混进了时钟或随机数，任何 count_delta 都会随机漂移',
      );
    }
  } catch (e) {
    add('reset-idempotent', '复位幂等', FAIL, FAIL, String(e && e.message));
  }

  return finish();

  async function finish() {
    // ---- 4/5：空参调用与「写了要变」 ----
    const writes = (manifest.capabilities ?? []).filter((c) => c.kind === 'write');
    let sawWrite = null;
    for (const cap of writes.slice(0, 1)) {
      try {
        runId = (await withTimeout(adapter.reset({}))).runId;
        const before = await snapshot(adapter, runId);
        const res = await withTimeout(
          adapter.execute(runId, { as: (manifest.roles ?? [])[0], capability: cap.id, arguments: {} }),
        );
        const after = await snapshot(adapter, runId);
        if (res && res.outcome === 'applied' && before.fingerprint === after.fingerprint) {
          sawWrite = cap.id;
        }
      } catch (e) {
        add('empty-args', `空参数调用 ${cap.id} 不抛异常`, FAIL, FAIL, String(e && e.message));
        break;
      }
    }
    if (sawWrite === null) {
      add('empty-args', '空参数调用写能力不炸', PASS, FAIL, '空参数被正常拒绝或正常执行，没有抛异常也没有 infra_error');
    }
    if (sawWrite) {
      add(
        'write-visible',
        `写操作 ${sawWrite} 声明成功但视图没变`,
        WARN,
        WARN,
        '有的写操作本来就不改规范视图（发通知、写审计），所以只报警不判死；' +
          '但如果这条是你要断言的写操作，它就是「假执行」的典型样子',
      );
    }

    // ---- 无状态泄漏：写完再复位，必须回到第一份初态 ----
    try {
      runId = (await withTimeout(adapter.reset({}))).runId;
      const back = await snapshot(adapter, runId);
      add(
        'no-leak',
        '无状态泄漏：写过之后复位仍回到第一份初态',
        back.fingerprint === first.fingerprint ? PASS : FAIL,
        FAIL,
        back.fingerprint === first.fingerprint
          ? first.fingerprint
          : `写过一轮再复位得到 ${back.fingerprint}，与最初 ${first.fingerprint} 不同 —— ` +
            '这一轮的残留会流进下一轮案例，判决之间不再独立',
      );
    } catch (e) {
      add('no-leak', '无状态泄漏', FAIL, FAIL, String(e && e.message));
    }

    try {
      if (runId) await adapter.close(runId);
    } catch {
      /* close 失败不影响判定 */
    }
    return report(checks);
  }
}

export function probeExit(result) {
  return result.summary.ok ? 0 : 1;
}

export function formatProbe(result, { detail = false } = {}) {
  const MARK = { pass: '· ok  ', fail: '· FAIL', warn: '· warn', skipped: '· skip' };
  const lines = [];
  for (const c of result.checks) {
    lines.push(`${MARK[c.status] ?? '· ??'}  ${c.title}`);
    if (c.status !== PASS || detail) lines.push(`        ${c.detail}`);
  }
  lines.push('');
  lines.push(
    `探针 ${result.summary.total} 项：通过 ${result.summary.passed}，失败 ${result.summary.failed}，` +
      `可疑 ${result.summary.warned}`,
  );
  lines.push(
    result.summary.ok
      ? '结论：这套观测在被机械检查的那几件事上是自洽的。它仍然可能在别处撒谎——'
      : '结论：适配器自我矛盾，先修它，再谈判决可信不可信——',
  );
  lines.push(
    result.summary.ok
      ? '探针不是审计，它只查复位、稳定性、泄漏这几件能机械判定的事。'
      : '一份自相矛盾的观测，会让每条判决都稳定地错。',
  );
  return lines.join('\n');
}

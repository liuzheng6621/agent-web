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
 *   6. 契约内 outcome  每次 execute 都必须回 applied/rejected/unsupported/infra_error 之一
 *
 * 第 5 条只报警不判死，因为有些写操作本来就不改规范视图（发通知、写审计日志）。
 * 报出来让人自己判，比替人判死要好。
 */

import { stableStringify, fingerprint } from './values.mjs';
import { validateAdapter, validateManifest, OUTCOMES } from './adapter/contract.mjs';

export const PROBE_VERSION = 'agent-web/probe-2';

const PASS = 'pass';
const FAIL = 'fail';
const WARN = 'warn';

function report(checks, probeOrder = []) {
  const failed = checks.filter((c) => c.status === FAIL);
  const warned = checks.filter((c) => c.status === WARN);
  return {
    probe_version: PROBE_VERSION,
    probe_order: probeOrder,
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

  // ---- 声明了 frozen 的适配器，时钟必须真的冻住 ----
  // 这一项只做单向判定：两次同 seed 复位指纹相同**不证明**它冻住了（可能刚好
  // 落在同一毫秒），但指纹不同就**证明**它在撒谎。所以「相同」时给 pass 并把
  // 这条局限写在 detail 里，不假装验过了。
  async function checkClockHonest() {
  const claims = Array.isArray(manifest.clock_policies) ? manifest.clock_policies : [];
  if (!claims.includes('frozen')) {
    add('clock-honest', '声明 frozen 的适配器时钟真的冻住', 'skipped', WARN,
      `manifest 没声明 frozen（声明的是 ${claims.length ? claims.join('/') : '空，按 wall 处理'}），无从验证`);
  } else {
    try {
      const seed = { clock_start: 1767225600000 };
      const a = await snapshot(adapter, (await withTimeout(adapter.reset({ seed, clockPolicy: 'frozen' }))).runId);
      const b = await snapshot(adapter, (await withTimeout(adapter.reset({ seed, clockPolicy: 'frozen' }))).runId);
      add(
        'clock-honest',
        '声明 frozen 的适配器时钟真的冻住',
        a.fingerprint === b.fingerprint ? PASS : FAIL,
        FAIL,
        a.fingerprint === b.fingerprint
          ? '同一 seed 两次复位视图逐字相同（这只证明「没有随机漂移」，不证明时间真的被冻结）'
          : `同一 seed 两次复位得到不同视图（${a.fingerprint} vs ${b.fingerprint}）—— `
            + '它声明了 frozen 却在读真实时钟，任何时间断言都会随机红',
      );
    } catch (e) {
      add('clock-honest', '声明 frozen 的适配器时钟真的冻住', FAIL, FAIL, String(e && e.message));
    }
  }
  }

  async function checkEmptyArgs() {
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
  }

  async function checkNoLeak() {
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
  }

  async function checkDeclaredVsBehavior() {
    // ---- 7：声明了的能力必须真的存在 ----
    // 覆盖率统计信的是 manifest 的声明。声明了、实现却回 unsupported，
    // 覆盖率会把它算成「已声明未使用」，而案例永远拿不到证据。
    try {
      const roles = manifest.roles ?? [];
      const caps = (manifest.capabilities ?? []).slice(0, 6);
      const role = roles[0];
      const missing = [];
      // 顺带把「契约外 outcome」也查了：它比 unsupported 更危险 ——
      // unsupported 至少会被判 coverage_gap，契约外的值会让这一步什么都不命中，
      // 一路滑到终态断言。这里只报，判死交给 runner。
      const offContract = [];
      for (const cap of caps) {
        runId = (await withTimeout(adapter.reset({}))).runId;
        const res = await withTimeout(adapter.execute(runId, { as: role, capability: cap.id, arguments: {} }));
        const code = res && res.error && res.error.code;
        if (!OUTCOMES.includes(res && res.outcome)) offContract.push(`${cap.id} → ${JSON.stringify(res && res.outcome)}`);
        if ((res && res.outcome === 'unsupported') || code === 'unsupported_capability') missing.push(cap.id);
      }
      add(
        'declared-vs-behavior',
        '声明了的能力真的存在',
        missing.length > 0 ? FAIL : PASS,
        FAIL,
        missing.length > 0
          ? `manifest 声明了但实现说没有：${missing.join('、')} —— 声明与行为对不上，覆盖率会跟着错`
          : `抽查 ${caps.length} 条能力，没有「声明了却回 unsupported」的`,
      );
      if (offContract.length > 0) {
        add(
          'outcome-contract',
          '每次 execute 都回契约内的 outcome',
          FAIL,
          FAIL,
          `返回了契约外的值：${offContract.join('、')} —— 只认 ${OUTCOMES.join(' / ')}。`
            + '契约外的值不会被任何分支命中，那一步会一路滑到终态断言，判决可能因此假通过',
        );
      } else {
        add('outcome-contract', '每次 execute 都回契约内的 outcome', PASS, FAIL, `抽查 ${caps.length} 条，全部在 ${OUTCOMES.join('/')} 内`);
      }
    } catch (e) {
      add('declared-vs-behavior', '声明了的能力真的存在', FAIL, FAIL, String(e && e.message));
    }
  }

  async function checkRoleEffective() {
    // ---- 8：角色必须真的生效 ----
    // 越权案例的全部价值在于「换个身份就做不成」。适配器若忽略 as，
    // 越权案例会稳定地 pass，而实际测的是同一个人的行为。
    try {
      const roles = manifest.roles ?? [];
      const restricted = (manifest.capabilities ?? []).find(
        (c) => c.kind === 'write' && Array.isArray(c.roles) && c.roles.length > 0 && roles.some((r) => !c.roles.includes(r)),
      );
      if (!restricted) {
        add('role-effective', '角色真的生效', 'skipped', WARN, '没有「只允许部分角色」的写能力，无从验证角色是否生效');
      } else {
        // 一条能力被「业务原因」拒绝（缺参数、状态不对）证明不了角色生效，
        // 所以把所有「只允许部分角色」的写能力都试一遍，只看角色类拒绝码。
        const restrictedCaps = (manifest.capabilities ?? []).filter(
          (c) => c.kind === 'write' && Array.isArray(c.roles) && c.roles.length > 0 && roles.some((r) => !c.roles.includes(r)),
        );
        // **每一条能力各挑一个「它不允许」的角色**，不能拿第一条挑出来的角色套到全部能力上。
        // 拿别人的角色去打别的能力，等于用「本来就有权的人」证明「越权被挡住了」——
        // 一旦有两三条能力的角色集合不同，这条检查就会诬告诚实实现（realworld 契约就这样：
        // users.create 允许 anonymous，user.update 只允许 user，同一个 outsider 不可能两边都不许）。
        const attempts = [];
        for (const cap of restrictedCaps) {
          const outsider = roles.find((r) => !cap.roles.includes(r));
          if (outsider) attempts.push({ cap, outsider });
        }
        const applied = [];
        const forbidden = [];
        const other = [];
        for (const { cap, outsider } of attempts.slice(0, 6)) {
          runId = (await withTimeout(adapter.reset({}))).runId;
          const res = await withTimeout(adapter.execute(runId, { as: outsider, capability: cap.id, arguments: {} }));
          const code = res && res.error && res.error.code;
          if (res && res.outcome === 'applied') applied.push(`${cap.id}(以 ${outsider})`);
          else if (code === 'forbidden' || code === 'not_owner' || code === 'unknown_role') forbidden.push(`${cap.id}(${code})`);
          else other.push(`${cap.id}(${code || (res && res.outcome) || '?'})`);
        }
        if (applied.length > 0) {
          add(
            'role-effective',
            '角色真的生效',
            FAIL,
            FAIL,
            `这些能力被不该有权的角色执行成功：${applied.join('、')} —— 换个身份就能绕过，越权案例全部无效`,
          );
        } else if (forbidden.length > 0) {
          add('role-effective', '角色真的生效', PASS, FAIL, `越权被挡住：${forbidden.join('、')}`);
        } else {
          add(
            'role-effective',
            '角色真的生效',
            'skipped',
            WARN,
            `试了 ${attempts.slice(0, 6).length} 条受限写能力，全是业务拒绝：${other.join('、')} —— 空参下证明不了角色生效`,
          );
        }
      }
    } catch (e) {
      add('role-effective', '角色真的生效', FAIL, FAIL, String(e && e.message));
    }
  }

  async function checkReadNoSideEffect() {
    // ---- 9：读操作不许偷偷写 ----
    // 「读」声明了 kind: read。读却改了状态，count_delta 会莫名其妙地漂，
    // 而且它是最容易伪造的谎：观测看起来永远正常。
    try {
      const read = (manifest.capabilities ?? []).find(
        (c) => c.kind === 'read' && (!c.args || Object.keys(c.args).every((k) => String(c.args[k]).endsWith('?'))),
      );
      if (!read) {
        add('read-no-side-effect', '读操作不改状态', 'skipped', WARN, '没有「参数全可选」的读能力，无从在空参下验证副作用');
      } else {
        runId = (await withTimeout(adapter.reset({}))).runId;
        const before = await snapshot(adapter, runId);
        const res = await withTimeout(adapter.execute(runId, { as: (manifest.roles ?? [])[0], capability: read.id, arguments: {} }));
        const after = await snapshot(adapter, runId);
        if (res && res.outcome === 'applied' && before.fingerprint !== after.fingerprint) {
          add(
            'read-no-side-effect',
            '读操作不改状态',
            FAIL,
            FAIL,
            `读能力 ${read.id} 执行后视图从 ${before.fingerprint} 变成 ${after.fingerprint} —— 读偷偷写了东西`,
          );
        } else {
          add(
            'read-no-side-effect',
            '读操作不改状态',
            PASS,
            FAIL,
            `${read.id} 执行后视图不变（${before.fingerprint}）`,
          );
        }
      }
    } catch (e) {
      add('read-no-side-effect', '读操作不改状态', FAIL, FAIL, String(e && e.message));
    }
  }

  async function checkCloseIdempotent() {
    // ---- 10：close 必须幂等 ----
    // 不幂等的 close 会在重试路径上炸：调用方重跑一次收尾就报错，
    // 而"收尾失败"看起来像被测系统的问题。这条不是洁癖 ——
    // 一个不能重复调用的清理函数，等于逼每个调用方自己记账。
    try {
      if (runId) {
        await adapter.close(runId);
        await adapter.close(runId);
        add('close-idempotent', 'close 可以重复调用', PASS, FAIL, '连续两次 close 都没抛错');
      } else {
        add('close-idempotent', 'close 可以重复调用', 'skipped', WARN, '没有拿到 runId，无从验证');
      }
    } catch (e) {
      add('close-idempotent', 'close 可以重复调用', FAIL, FAIL, `第二次 close 抛错：${e && e.message}`);
    }
  }

  // ---- 中段五项互相独立（各自带 reset），每次跑都洗牌 ----
  // 对抗「读得到源码的适配器」：它不能再靠「第 N 次 reset 之后必然是哪项检查」
  // 区分探测与运行。洗牌只覆盖这五项；开场复位三件套、no-leak（必须在所有
  // 执行器之后抓写残留）与 close 幂等（必须最后）三个锚点仍固定 —— 每项内部
  // 的交互模式也固定，微观指纹仍可区分。这条局限写在 LIMITS L8。
  const middleChecks = [
    ['clock-honest', checkClockHonest],
    ['empty-args', checkEmptyArgs],
    ['declared-vs-behavior', checkDeclaredVsBehavior],
    ['role-effective', checkRoleEffective],
    ['read-no-side-effect', checkReadNoSideEffect],
  ];
  for (let i = middleChecks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [middleChecks[i], middleChecks[j]] = [middleChecks[j], middleChecks[i]];
  }
  const probeOrder = middleChecks.map(([id]) => id);
  for (const [, fn] of middleChecks) await fn();

  // no-leak 固定在执行器检查之后；close 幂等永远最后（close 后适配器不再保证可用）。
  await checkNoLeak();
  await checkCloseIdempotent();

  return report(checks, probeOrder);
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

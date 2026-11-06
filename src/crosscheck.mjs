/**
 * crosscheck 的执行层：把「适配器说的」与「独立通道看到的」对上。
 *
 * 独立通道怎么做：**不经过适配器自己的 fetch**，用 globalThis.fetch 直连 baseUrl。
 * 这不是沙箱——适配器仍可篡改 globalThis.fetch。它挡的是「适配器在返回体里做手脚」，
 * 挡不住「适配器把整个 fetch 换掉」。这条边界写进 LIMITS，不改口。
 */
import { verdictOf, summarize, exitOf, CROSSCHECK_VERSION } from './assert/crosscheck.mjs';

export { CROSSCHECK_VERSION };

/** 适配器是否走 HTTP：看 manifest 有没有 baseUrl 或者能力表里有没有 http 路径。 */
export function isHttpAdapter(manifest, adapter) {
  if (manifest && typeof manifest.baseUrl === 'string' && manifest.baseUrl) return true;
  if (adapter && typeof adapter.baseUrl === 'string' && adapter.baseUrl) return true;
  const caps = (manifest && manifest.capabilities) || [];
  return caps.some((c) => typeof c.http === 'string' || typeof c.path === 'string');
}

/**
 * 从 manifest 里挑出可复核的只读能力。
 * 只认「读」：写能力会改状态，两个通道顺序调用必然不同。
 */
export function pickReadCapabilities(manifest) {
  const caps = (manifest && manifest.capabilities) || [];
  return caps.filter((c) => {
    if (c.kind && c.kind !== 'read') return false;
    const args = c.args || {};
    // 需要参数的读能力也不复核：独立通道不知道该填什么（适配器可能会填它自己编的值）。
    return Object.keys(args).length === 0;
  });
}

/**
 * 用独立通道发一次请求。
 * path 优先取能力声明的 http 路径，没有就用 capability id 猜——猜不到就跳过。
 */
async function fetchDirect(baseUrl, path, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await globalThis.fetch(baseUrl.replace(/\/+$/, '') + path, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    const text = await res.text();
    try {
      return { ok: true, status: res.status, body: JSON.parse(text) };
    } catch {
      return { ok: true, status: res.status, body: text };
    }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 主流程。
 *
 * 每条只读能力做两件事：
 *   1. 通过适配器读一次（observe 里的集合，或者 execute 的读能力）
 *   2. 用独立 fetch 直连同一个路径
 * 然后比指纹。
 *
 * @param {object} args
 * @param {object} args.adapter
 * @param {string} args.adapterName
 * @param {object} [args.manifest]
 * @param {string} [args.baseUrl]     独立通道要打的地址；适配器自带就用适配器的
 * @param {number} [args.timeoutMs]
 */
export async function crosscheck({ adapter, adapterName, manifest, baseUrl, timeoutMs = 8000 }) {
  const man = manifest || (typeof adapter.manifest === 'function' ? await adapter.manifest() : null);
  const http = isHttpAdapter(man, adapter);
  const root = baseUrl || (man && man.baseUrl) || (adapter && adapter.baseUrl) || null;
  const rows = [];

  if (!http) {
    // 不走 HTTP：一条都不复核，但**要说清理由**，不能默默给个空报告。
    return {
      version: CROSSCHECK_VERSION,
      adapter: adapterName,
      rows: [],
      summary: summarize([]),
      exitCode: 2,
      reason: '适配器不走 HTTP（内存 / 孪生 / 夹具），没有独立通道可对照',
    };
  }

  if (!root) {
    return {
      version: CROSSCHECK_VERSION,
      adapter: adapterName,
      rows: [],
      summary: summarize([]),
      exitCode: 2,
      reason: '适配器声明了走 HTTP，但没给 baseUrl：不知道该直连哪里',
    };
  }

  const caps = pickReadCapabilities(man);
  const runId = await (async () => {
    const r = await adapter.reset();
    return r && r.runId ? r.runId : null;
  })();

  for (const cap of caps) {
    const path = cap.http || cap.path || null;
    if (!path) {
      rows.push({
        capability: cap.id,
        status: 'uncheckable',
        code: 'no_path',
        message: '这条能力没声明 HTTP 路径，独立通道不知道打哪里',
      });
      continue;
    }

    // 经适配器：读能力的返回值就是 observe 里的集合，或者 execute 的 payload。
    let viaAdapter;
    let adapterErr = null;
    try {
      if (cap.id.includes('.')) {
        const res = await adapter.execute(runId, { capability: cap.id, arguments: {}, as: cap.roles ? cap.roles[0] : undefined });
        viaAdapter = res && (res.payload !== undefined ? res.payload : res);
        if (res && res.outcome && res.outcome !== 'applied') adapterErr = `适配器返回 ${res.outcome}`;
      }
    } catch (e) {
      adapterErr = e && e.message ? e.message : String(e);
    }
    if (adapterErr) {
      rows.push({ capability: cap.id, status: 'uncheckable', code: 'adapter_error', message: adapterErr });
      continue;
    }

    const direct = await fetchDirect(root, path, timeoutMs);
    if (!direct.ok) {
      rows.push({
        capability: cap.id,
        status: 'uncheckable',
        code: 'direct_failed',
        message: `独立通道连不上：${direct.error}`,
      });
      continue;
    }

    const v = verdictOf({ httpAdapter: true, viaAdapter, viaDirect: direct.body });
    rows.push({ capability: cap.id, ...v });
  }

  if (typeof adapter.close === 'function') {
    try { await adapter.close(runId); } catch { /* 关不掉不影响结论 */ }
  }

  return {
    version: CROSSCHECK_VERSION,
    adapter: adapterName,
    baseUrl: root,
    rows,
    summary: summarize(rows),
    exitCode: exitOf(rows),
  };
}

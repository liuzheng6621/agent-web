/**
 * 回放孪生：第二实现，不要钱——它就是一份录制的状态机。
 *
 * 语义（写清楚，不装）：
 *   - 孪生只覆盖录到的路径。没录到的能力返回 unsupported，不返回 applied。
 *   - 孪生按录制的顺序回放：第 i 次写操作必须对上录制里第 i 步的能力与请求体，
 *     对不上就是 unsupported/out_of_order。它不模拟并发，也不模拟分支。
 *   - 孪生的判决意义是「今天的应用仍然同意那份录制」：live 与 twin 对照，
 *     红了说明行为偏离录制；未观察到的路径留在 unknown 的分母里。
 */

import { validateManifest } from './contract.mjs';

export const TWIN_VERSION = 'agent-web/twin-1';

/** 从录制的集合初态里取字段名（取所有行键的并集，排序保证稳定）。 */
function fieldsOf(rows) {
  const set = new Set();
  for (const row of rows || []) {
    if (row && typeof row === 'object') for (const k of Object.keys(row)) set.add(k);
  }
  return [...set].sort();
}

export function createTwinAdapter(twin, options = {}) {
  let state = null;
  let cursor = 0;
  let runCounter = 0;

  const clone = (v) => JSON.parse(JSON.stringify(v));

  async function manifest() {
    const m = {
      adapter: options.name || 'twin',
      adapter_version: '1.0.0',
      reset_strategy: 'snapshot',
      description: `回放孪生（${twin.version || TWIN_VERSION}）：录制的状态机，只覆盖录到的路径`,
      scopes: twin.collections,
      roles: twin.roles,
      events_complete: false,
      canonical_view: 'agent-web/canonical-view',
      view: {
        version: 'agent-web/view/1',
        collections: Object.fromEntries(
          twin.collections.map((name) => [name, {
            kind: 'list',
            // 必填字段从录制初态取，与 learn 生成的 adapter.yml 对齐——否则两边视图不可比，
            // compare 会退化成「碰巧一致」
            required: fieldsOf([...(twin.initial[name] || []), ...(twin.final[name] || [])]),
            semantics: `${name}（录制投影）`,
          }]),
        ),
      },
      capabilities: twin.capabilities.map((id) => ({
        id,
        kind: twin.steps.some((s) => s.capability === id) ? 'write' : 'read',
        evidence_level: 'observed',
        roles: twin.roles,
        args: {},
      })),
      twin: { version: TWIN_VERSION, steps: twin.steps.length },
    };
    const errs = validateManifest(m);
    if (errs.length) throw new Error(`孪生 manifest 不合法：${errs.join('；')}`);
    return m;
  }

  async function reset() {
    runCounter += 1;
    state = clone(twin.initial);
    cursor = 0;
    return { runId: `twin-${runCounter}`, state: clone(state) };
  }

  async function observe(runId, scopes) {
    const wanted = scopes && scopes.length ? scopes : twin.collections;
    const missing = wanted.filter((s) => !twin.collections.includes(s));
    const out = {};
    for (const s of wanted) if (state && state[s]) out[s] = clone(state[s]);
    for (const s of wanted) if (!out[s]) out[s] = [];
    if (!state) return { state: null, missingScopes: wanted };
    return { state: out, missingScopes: missing };
  }

  async function execute(runId, action) {
    const step = twin.steps[cursor];
    if (!step) return { outcome: 'unsupported', error: { code: 'twin_exhausted', message: '录制里没有更多步' } };
    if (step.capability !== action.capability) {
      return { outcome: 'unsupported', error: { code: 'out_of_order', message: `录制第 ${cursor + 1} 步是 ${step.capability}，收到 ${action.capability}` } };
    }
    for (const [k, v] of Object.entries(step.body || {})) {
      if (JSON.stringify((action.arguments || {})[k] ?? null) !== JSON.stringify(v ?? null)) {
        return { outcome: 'unsupported', error: { code: 'args_mismatch', message: `字段 ${k} 与录制不一致` } };
      }
    }
    cursor += 1;
    for (const [col, rows] of Object.entries(step.delta || {})) state[col] = clone(rows);
    if (step.outcome === 'rejected') {
      return { outcome: 'rejected', error: { code: step.code || 'recorded_reject', message: '录制里这一步被拒绝' } };
    }
    return { outcome: 'applied', payload: { twin_step: cursor } };
  }

  async function close() {
    state = null;
    cursor = 0;
  }

  return { manifest, reset, observe, execute, close };
}

export function loadTwin(file, fsMod) {
  const fs = fsMod;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

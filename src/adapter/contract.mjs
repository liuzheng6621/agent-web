/**
 * 适配器契约。
 *
 * 这是本仓库对外的唯一接口约定。任何应用只要能提供这五个方法，就能被考。
 * 刻意做得很小：小接口才有人实现，大接口只有作者自己实现。
 *
 *   manifest()                        -> 能力清单（含证据等级与输入域）
 *   reset({ seed, clockPolicy })      -> { runId, state }        复位到可重放初态
 *   observe(runId, scopes)            -> { state, missingScopes } 读当前可观测状态
 *   execute(runId, action)            -> { outcome, payload }     执行一个动作
 *   close(runId)                      -> void
 *
 * outcome 必须四选一，不允许合并：
 *   applied       动作被执行了
 *   rejected      应用自己拒绝了（业务规则 / 权限 / 冲突）
 *   unsupported   适配器演不了（覆盖缺口）
 *   infra_error   适配器或下层故障
 *
 * 四者混淆是这类系统最常见的错误：
 * 把 unsupported 当 rejected，会让"覆盖不足"被记成"应用拒绝"，指标虚高。
 */

import { validateViewContract } from '../view.mjs';

export const OUTCOMES = Object.freeze(['applied', 'rejected', 'unsupported', 'infra_error']);
export const CAPABILITY_KINDS = Object.freeze(['read', 'write', 'session']);

export const EVIDENCE_LEVELS = Object.freeze(['observed', 'inferred', 'validated']);

/**
 * reset 的三条可行路径。适配器必须在 manifest 里声明自己走哪条。
 *   snapshot  整份覆盖（文件 / 内存型夹具）—— 最便宜
 *   reseed    重建 schema 并注入种子 —— 需要后端支持
 *   identity  以新身份隔离（应用自带多用户边界）—— 最便宜的「真实后端」方案
 *
 * 第三条容易被忽略：多数应用本来就有账号体系，
 * 每个 case 用一个新账号，天然复位、天然隔离，不需要动数据库。
 */
export const RESET_STRATEGIES = Object.freeze(['snapshot', 'reseed', 'identity']);

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest 必须是对象'];
  for (const f of ['adapter', 'adapter_version', 'reset_strategy']) {
    if (typeof m[f] !== 'string' || m[f] === '') errors.push(`manifest.${f} 必填`);
  }
  if (m.reset_strategy && !RESET_STRATEGIES.includes(m.reset_strategy)) {
    errors.push(`manifest.reset_strategy 必须是 ${RESET_STRATEGIES.join('/')}`);
  }
  if (m.events_types !== undefined && m.events_types !== null) {
    if (!Array.isArray(m.events_types) || m.events_types.some((t) => typeof t !== 'string')) {
      errors.push('manifest.events_types 必须是字符串数组（不声明就表示未知，按 events_complete 判定）');
    }
  }
  if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) {
    errors.push('manifest.capabilities 必须是非空数组');
  } else {
    m.capabilities.forEach((c, i) => {
      const at = `manifest.capabilities[${i}]`;
      if (typeof c.id !== 'string' || c.id === '') errors.push(`${at}.id 必填`);
      if (!CAPABILITY_KINDS.includes(c.kind)) {
        errors.push(`${at}.kind 必须是 ${CAPABILITY_KINDS.join('/')}`);
      }
      if (!EVIDENCE_LEVELS.includes(c.evidence_level)) {
        errors.push(`${at}.evidence_level 必须是 ${EVIDENCE_LEVELS.join('/')}`);
      }
      if (c.args !== undefined && typeof c.args !== 'object') errors.push(`${at}.args 必须是对象`);
    });
  }
  if (!Array.isArray(m.scopes) || m.scopes.length === 0) {
    errors.push('manifest.scopes 必须是非空数组（可观测作用域）');
  }
  // 视图契约可选，但一旦声明就必须合法——半份契约比没有契约更危险。
  errors.push(...validateViewContract(m.view));
  return errors;
}

export function validateAdapter(adapter) {
  const errors = [];
  if (!adapter || typeof adapter !== 'object') return ['适配器必须是对象'];
  for (const f of ['manifest', 'reset', 'observe', 'execute', 'close']) {
    if (typeof adapter[f] !== 'function') errors.push(`适配器需要 ${f}() 方法`);
  }
  return errors;
}

/** 一条证据：能力是否足够可信到可以据以判卷。 */
export function evidenceLevelOf(manifest, capabilityId) {
  const cap = (manifest.capabilities || []).find((c) => c.id === capabilityId);
  return cap ? cap.evidence_level : null;
}

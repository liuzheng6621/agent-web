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
 * outcome 必须五选一，不允许合并：
 *   applied             动作被执行了
 *   rejected            应用自己拒绝了（业务规则 / 权限 / 冲突）
 *   unsupported         适配器演不了（覆盖缺口）
 *   infra_error         适配器或下层故障，**这次调用没发生**
 *   may_have_committed  请求发出去了，但结果没回来 —— 可能已经生效
 *
 * 五者混淆是这类系统最常见的错误：
 * 把 unsupported 当 rejected，会让"覆盖不足"被记成"应用拒绝"，指标虚高。
 *
 * 最后一档是重放安全的唯一支点，也是它容易被省掉的原因：
 * infra_error 与 may_have_committed 是两条**相反**的重放指令——
 * 前者说"可以重试"，后者说"不许重试，先去看状态"。
 * 把超时、连接断在响应前、后端 5xx 塞进 infra_error，判决本身看不出问题（都判 unknown），
 * 但重放器会照着重跑一遍，把已经扣了的钱再扣一次。
 */

import { validateViewContract } from '../view.mjs';

export const OUTCOMES = Object.freeze([
  'applied',
  'rejected',
  'unsupported',
  'infra_error',
  'may_have_committed',
]);

/** 这一档意味着「可能已经生效」，重放器据此拒绝重复执行同一步。 */
export const UNCERTAIN_OUTCOMES = Object.freeze(['may_have_committed']);
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

/**
 * 时钟策略。案例用 `environment.clock_policy` 声明，适配器用
 * `manifest.clock_policies` 声明自己支持哪几种，两边必须对得上。
 *
 *   frozen  适配器自己掌管时间：同一 seed 下重放，所有时间戳逐字相同
 *   wall    用真实时钟：时间戳每次都不同，`timeliness` 靠真实耗时
 *
 * 为什么必须两边都声明：一个适配器可以「看起来支持 frozen」——它把时间戳
 * 写进视图，但取的是 `Date.now()`。案例声明 frozen、判决照样 pass，
 * 因为没有任何断言在比时间戳。等到某天有人加了一条 `timeliness`，
 * 它会随机红——而且只在慢机器上红。这个谎必须在契约层拦，不能靠断言。
 *
 * 不声明 `clock_policies` 的适配器按只支持 `wall` 处理：这是保守默认值，
 * 因为「能冻结时间」是额外能力，不能假设。
 */
export const CLOCK_POLICIES = Object.freeze(['frozen', 'wall']);
export const DEFAULT_CLOCK_POLICY = 'wall';

export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['manifest 必须是对象'];
  for (const f of ['adapter', 'adapter_version', 'reset_strategy']) {
    if (typeof m[f] !== 'string' || m[f] === '') errors.push(`manifest.${f} 必填`);
  }
  if (m.reset_strategy && !RESET_STRATEGIES.includes(m.reset_strategy)) {
    errors.push(`manifest.reset_strategy 必须是 ${RESET_STRATEGIES.join('/')}`);
  }
  if (m.clock_policies !== undefined) {
    if (!Array.isArray(m.clock_policies) || m.clock_policies.length === 0) {
      errors.push(`manifest.clock_policies 必须是非空数组（只认 ${CLOCK_POLICIES.join('/')}）`);
    } else {
      for (const p of m.clock_policies) {
        if (!CLOCK_POLICIES.includes(p)) {
          errors.push(`manifest.clock_policies 里有 ${JSON.stringify(p)}，只认 ${CLOCK_POLICIES.join('/')}`);
        }
      }
    }
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
      // 约束是可选的，但一旦声明就必须合法：半份约束比没有约束更危险
      // （工具会按它派生边界输入，写错了就派生出错的负例）。
      if (c.constraints !== undefined) {
        if (typeof c.constraints !== 'object' || c.constraints === null || Array.isArray(c.constraints)) {
          errors.push(`${at}.constraints 必须是对象（键是参数路径，值是 {min,max,integer,enum}）`);
        } else {
          for (const [key, spec] of Object.entries(c.constraints)) {
            const kat = `${at}.constraints[${JSON.stringify(key)}]`;
            if (typeof spec !== 'object' || spec === null) {
              errors.push(`${kat} 必须是对象`);
              continue;
            }
            const known = ['min', 'max', 'integer', 'enum'];
            for (const k of Object.keys(spec)) {
              if (!known.includes(k)) errors.push(`${kat}.${k} 不是约束项（只认 ${known.join('/')}）`);
            }
            if (spec.min !== undefined && !Number.isFinite(spec.min)) errors.push(`${kat}.min 必须是数字`);
            if (spec.max !== undefined && !Number.isFinite(spec.max)) errors.push(`${kat}.max 必须是数字`);
            if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
              errors.push(`${kat}.min 大于 max（${spec.min} > ${spec.max}）`);
            }
            if (spec.enum !== undefined && !Array.isArray(spec.enum)) errors.push(`${kat}.enum 必须是数组`);
            if (Object.keys(spec).length === 0) errors.push(`${kat} 是空约束，删掉它或写点东西`);
          }
        }
      }
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

/**
 * 规范视图契约。
 *
 * 断言写在视图上，所以视图必须是一份**声明**，不能是默契。
 *
 * 在此之前，适配器返回什么形状全凭自觉：断言写 `path: "status"`，
 * 适配器可能返回 `state.state`，也可能是 `state.statusCode`。这种错配不会报错，
 * 只会让断言变成 unknown —— 而 unknown 和"真的没观测到"混在一起，
 * 分不清是契约没满足，还是环境暂时看不见。
 *
 * 声明之后，这三件事分开算：
 *   - 契约不满足 → unknown / invalid_environment（适配器没按约定投影）
 *   - 集合为空   → 断言各自报 missing_observation（观测到了，只是没有实体）
 *   - 字段值不符 → false（这才是被测系统的行为）
 *
 * 还有一个作用：两个适配器声明同一份视图契约，案例才真的可移植。
 * compare 会把契约差异打出来 —— 契约不同而判决相同，只是碰巧。
 */

import { getPath } from './values.mjs';

export const VIEW_VERSION = 'agent-web/view/1';

export const COLLECTION_KINDS = Object.freeze(['list', 'object', 'scalar']);

/** 校验 manifest.view 的声明本身是否合法。 */
export function validateViewContract(view) {
  const errors = [];
  if (view === undefined) return errors; // 视图契约可选，老适配器照跑
  if (!view || typeof view !== 'object' || Array.isArray(view)) return ['manifest.view 必须是对象'];

  if (view.version !== VIEW_VERSION) {
    errors.push(`manifest.view.version 必须是 ${VIEW_VERSION}`);
  }
  const cols = view.collections;
  if (!cols || typeof cols !== 'object' || Array.isArray(cols)) {
    errors.push('manifest.view.collections 必须是对象');
    return errors;
  }
  if (Object.keys(cols).length === 0) {
    errors.push('manifest.view.collections 不能为空');
  }

  for (const [name, spec] of Object.entries(cols)) {
    const at = `manifest.view.collections["${name}"]`;
    if (name.trim() === '') errors.push(`${at} 名字不能为空`);
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      errors.push(`${at} 必须是对象`);
      continue;
    }
    if (!COLLECTION_KINDS.includes(spec.kind)) {
      errors.push(`${at}.kind 必须是 ${COLLECTION_KINDS.join('/')}`);
    }
    if (spec.required !== undefined) {
      if (!Array.isArray(spec.required) || spec.required.some((f) => typeof f !== 'string' || f === '')) {
        errors.push(`${at}.required 必须是非空字符串数组`);
      }
    }
    if (spec.semantics !== undefined && typeof spec.semantics !== 'string') {
      errors.push(`${at}.semantics 必须是字符串`);
    }
  }
  return errors;
}

/**
 * 拿一次观测结果去对契约。
 * 返回 { ok, errors: [{ code, collection, detail }] }
 */
export function checkStateAgainstView(state, view) {
  if (!view || !view.collections) return { ok: true, errors: [] };
  if (!state || typeof state !== 'object') {
    return { ok: false, errors: [{ code: 'state_not_object', collection: null, detail: '观测结果不是对象' }] };
  }

  const errors = [];
  for (const [name, spec] of Object.entries(view.collections)) {
    const value = getPath(state, name);

    if (value === undefined) {
      errors.push({ code: 'missing_collection', collection: name, detail: `视图契约声明了 ${name}，观测结果里没有` });
      continue;
    }
    if (value === null) continue; // 明确给 null 表示"这个域这次没有"，不算违约

    if (spec.kind === 'list' && !Array.isArray(value)) {
      errors.push({ code: 'wrong_kind', collection: name, detail: `${name} 声明为 list，实际是 ${typeof value}` });
      continue;
    }
    if (spec.kind === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors.push({ code: 'wrong_kind', collection: name, detail: `${name} 声明为 object，实际是 ${Array.isArray(value) ? 'array' : typeof value}` });
      continue;
    }

    const required = spec.required ?? [];
    if (required.length === 0) continue;

    // list 只看每一项：缺字段报第一条，避免一屏噪音。
    const rows = spec.kind === 'list' ? value : [value];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row === null || typeof row !== 'object') {
        errors.push({ code: 'wrong_kind', collection: name, detail: `${name}[${i}] 不是对象，无法检查 required 字段` });
        break;
      }
      const missing = required.filter((f) => row[f] === undefined);
      if (missing.length > 0) {
        errors.push({
          code: 'missing_field',
          collection: name,
          detail: `${name}[${i}] 缺字段 ${missing.join(', ')}（契约要求 ${required.join(', ')}）`,
        });
        break;
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 给人读的视图描述。 */
export function describeView(view) {
  if (!view || !view.collections) return '（未声明视图契约）';
  const lines = [];
  for (const [name, spec] of Object.entries(view.collections)) {
    const req = spec.required?.length ? ` : ${spec.required.join(', ')}` : '';
    const sem = spec.semantics ? `  // ${spec.semantics}` : '';
    lines.push(`${name} <${spec.kind}>${req}${sem}`);
  }
  return lines.join('\n');
}

/**
 * 两份视图契约的差异。compare 用它回答一个问题：
 * 判决一致，是因为两个实现真的等价，还是因为它们的视图根本不可比？
 */
export function diffViews(a, b) {
  const ca = a?.collections ?? {};
  const cb = b?.collections ?? {};
  const onlyA = Object.keys(ca).filter((k) => !(k in cb));
  const onlyB = Object.keys(cb).filter((k) => !(k in ca));
  const shared = Object.keys(ca).filter((k) => k in cb);

  const differences = [];
  for (const k of shared) {
    const ka = ca[k].kind;
    const kb = cb[k].kind;
    if (ka !== kb) differences.push(`${k}: kind ${ka} vs ${kb}`);
    const ra = [...(ca[k].required ?? [])].sort().join(',');
    const rb = [...(cb[k].required ?? [])].sort().join(',');
    if (ra !== rb) differences.push(`${k}: required [${ra}] vs [${rb}]`);
  }

  return {
    compatible: onlyA.length === 0 && onlyB.length === 0 && differences.length === 0,
    onlyA,
    onlyB,
    differences,
  };
}

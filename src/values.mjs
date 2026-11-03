/**
 * 值比较与语义指纹。
 *
 * 指纹用于 unchanged 断言与轨迹摘要：只比较语义，不比较顺序以外的噪声。
 * 归一化规则集中在这里，版本号随格式一起冻结（normalization_version）。
 */

export const NORMALIZATION_VERSION = 'norm-1';

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return false;
    if (!deepEqual(a[ka[i]], b[kb[i]])) return false;
  }
  return true;
}

/**
 * 稳定序列化：键排序、去掉 undefined。
 * 同一份状态对象每次算出的字符串必须逐字节相同，否则指纹没有意义。
 */
export function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] === undefined) continue;
      out[k] = walk(v[k]);
    }
    seen.delete(v);
    return out;
  };
  return JSON.stringify(walk(value));
}

/** 语义指纹：稳定序列化后的短哈希（FNV-1a 32 位，够用且零依赖）。 */
export function fingerprint(value) {
  const s = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a32:${h.toString(16).padStart(8, '0')}`;
}

/** 从对象里按点号路径取值。'length' 对数组/字符串取长度。 */
export function getPath(root, path) {
  if (path === undefined || path === null || path === '') return root;
  const parts = String(path).split('.');
  let cur = root;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (p === 'length') {
      if (Array.isArray(cur) || typeof cur === 'string') {
        cur = cur.length;
        continue;
      }
      return undefined;
    }
    if (Array.isArray(cur) && /^\d+$/.test(p)) {
      cur = cur[Number(p)];
      continue;
    }
    cur = cur[p];
  }
  return cur;
}

export function setPath(root, path, value) {
  const parts = String(path).split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (cur[p] === undefined || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}

/**
 * Kleene 三值逻辑。
 *
 * 为什么是三值而不是布尔：一条断言可能因为「观测范围不足」而既非真也非假。
 * 把它压成 false 会冤枉正确的轨迹，压成 true 会放过错误的轨迹。
 * unknown 必须在 verdict 里活着，且留在分母里。
 */

export const TRUE = 'true';
export const FALSE = 'false';
export const UNKNOWN = 'unknown';

export const VALUES = Object.freeze([TRUE, FALSE, UNKNOWN]);

export function and(...vals) {
  if (vals.some((v) => v === FALSE)) return FALSE;
  if (vals.some((v) => v === UNKNOWN)) return UNKNOWN;
  return TRUE;
}

export function or(...vals) {
  if (vals.some((v) => v === TRUE)) return TRUE;
  if (vals.some((v) => v === UNKNOWN)) return UNKNOWN;
  return FALSE;
}

export function not(v) {
  if (v === TRUE) return FALSE;
  if (v === FALSE) return TRUE;
  return UNKNOWN;
}

export function fromBool(b) {
  return b ? TRUE : FALSE;
}

export function isValue(v) {
  return v === TRUE || v === FALSE || v === UNKNOWN;
}

export function assertValue(v, where = 'value') {
  if (!isValue(v)) {
    throw new TypeError(`${where} 必须是 ${VALUES.join(' / ')}，收到 ${JSON.stringify(v)}`);
  }
  return v;
}

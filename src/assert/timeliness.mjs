// timeliness：基于**真实时间戳**的约束，而不是步号。
//
// 为什么必须单独一种 kind：步号坐标能说「第 3 步之后状态没变」，说不出
// 「发货必须在付款后 24 小时内」。后者需要事件时间戳、时钟来源、时区、缺时间与
// 边界比较语义——这些都不能用「第几步」替代。
//
// 三条硬边界（写死在代码里，不是文档里的君子协定）：
//   1. 事件没时间戳 → unknown/missing_observation，**不判假**（看不见不等于做错了）
//   2. 时区没声明 → unknown/missing_timezone，不猜
//   3. 恰好等于上限 → 成立（"24 小时内"包含 24 小时）

const HOUR = 3600000;

/** 把 24h / 90m / 5000ms 这类写法换成毫秒。 */
export function durationMs(text) {
  const t = String(text).trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { ms: 1, s: 1000, m: 60000, h: HOUR, d: 24 * HOUR }[unit];
  return n * mult;
}

function toMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** 在某个集合里找最早/最晚的匹配事件。 */
function findEvent(rows, spec) {
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (spec.type !== undefined && r.type !== spec.type) return false;
    // 'value' in spec 而不是 spec.value !== undefined：显式 value:null（比如
    // 「operator_id 为空的系统行」）是合法匹配条件；用 !== undefined 判断会把
    // 「想匹配 null」当成「没写条件」而放过所有行。
    if (spec.field !== undefined && spec && 'value' in spec && r[spec.field] !== spec.value) return false;
    return true;
  });
  if (matches.length === 0) return null;
  return spec.pick === 'last' ? matches[matches.length - 1] : matches[0];
}

/**
 * @param {object} a  断言
 * @param {object} ctx 求值上下文（含 final 视图与 trace）
 * @param {function} evalFn 未使用，保持与其它 kind 一致的签名
 */
export function timeliness(a, ctx) {
  const view = ctx && ctx.final;
  if (!view || typeof view !== 'object') {
    return { status: 'unknown', code: 'missing_observation', message: '没有终态视图，看不到事件时间' };
  }
  if (a.timezone === undefined || a.timezone === null) {
    return {
      status: 'unknown',
      code: 'missing_timezone',
      message: '没声明时区。时间比较必须先说清用哪个时钟，否则「24 小时」在跨时区里没有意义',
    };
  }
  const limit = a.max_ms !== undefined ? a.max_ms : durationMs(a.max ?? '');
  if (!Number.isFinite(limit)) {
    return { status: 'unknown', code: 'invalid_case', message: `上限 ${JSON.stringify(a.max)} 读不成时长` };
  }
  const collection = a.collection ?? 'status_log';
  const rows = view[collection];
  if (!Array.isArray(rows)) {
    return {
      status: 'unknown',
      code: 'missing_observation',
      message: `视图里没有 ${collection} 这个集合，看不到事件`,
    };
  }

  const fromSpec = a.from ?? {};
  const toSpec = a.to ?? {};
  const fromRow = findEvent(rows, fromSpec);
  const toRow = findEvent(rows, toSpec);
  if (!fromRow) {
    return { status: 'unknown', code: 'missing_observation', message: `找不到起点事件 ${JSON.stringify(fromSpec)}` };
  }
  if (!toRow) {
    return { status: 'unknown', code: 'missing_observation', message: `找不到终点事件 ${JSON.stringify(toSpec)}` };
  }

  const fromAt = toMs(fromRow[a.at_field ?? 'at']);
  const toAt = toMs(toRow[a.at_field ?? 'at']);
  if (fromAt === null || toAt === null) {
    return {
      status: 'unknown',
      code: 'missing_observation',
      message: `事件缺时间戳（${a.at_field ?? 'at'}）：起点 ${JSON.stringify(fromRow[a.at_field ?? 'at'])}，终点 ${JSON.stringify(toRow[a.at_field ?? 'at'])}`,
    };
  }

  const gap = toAt - fromAt;
  if (gap < 0) {
    return {
      status: 'false',
      code: 'timeliness_violated',
      message: `终点事件比起点事件早 ${-gap}ms：${JSON.stringify(toSpec)} 在 ${JSON.stringify(fromSpec)} 之前发生`,
    };
  }
  // 恰好等于上限算成立：「24 小时内」包含 24 小时。
  if (gap > limit) {
    return {
      status: 'false',
      code: 'timeliness_violated',
      message: `超出上限：实际 ${gap}ms（${(gap / HOUR).toFixed(2)}h），上限 ${limit}ms（${(limit / HOUR).toFixed(2)}h）`,
    };
  }
  return {
    status: 'true',
    code: 'ok',
    message: `间隔 ${gap}ms（${(gap / HOUR).toFixed(2)}h），上限 ${(limit / HOUR).toFixed(2)}h`,
  };
}

export const TIMELINESS_VERSION = 'agent-web/timeliness-1';

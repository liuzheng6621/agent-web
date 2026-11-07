// recurrence：节律断言。
//
// 为什么必须有这一种：timeliness 只能比「A 事件到 B 事件」的间隔，
// 说不出「在 6 小时窗口里，这个任务必须恰好按每小时一次跑满 6 次」。
// 前者是两个点，后者是一串槽位 —— 漏一个、多一个、漂一点，是三种不同的坏法，
// count_delta 只看总数，三者全混成一个「数量不对」。
//
// 三条硬边界（与 timeliness 对齐，写死在代码里）：
//   1. 没声明时区 → unknown/missing_timezone，不猜
//   2. 时间戳读不成 → unknown/missing_observation，不判假（看不见不等于做错了）
//   3. tolerance_ms 默认 0：节律必须精确，除非案例显式放宽

import { durationMs } from './timeliness.mjs';
import { selectEntities, describeSelector } from '../select.mjs';
import { getPath } from '../values.mjs';

export const RECURRENCE_VERSION = 'agent-web/recurrence-1';

const MAX_SLOTS = 10000;

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

function unknown(code, message) {
  return { status: 'unknown', code, message };
}

function bad(code, message) {
  return { status: 'false', code, message };
}

export function recurrence(a, ctx) {
  const view = ctx && ctx.final;
  if (!view || typeof view !== 'object') {
    return unknown('missing_observation', '没有终态视图，看不到运行记录');
  }
  if (a.timezone === undefined || a.timezone === null) {
    return unknown(
      'missing_timezone',
      '没声明时区。节律比较必须先说清用哪个时钟，否则「每小时一次」在跨时区里没有意义',
    );
  }
  const every = durationMs(a.every ?? '');
  if (!Number.isFinite(every) || every <= 0) {
    return unknown('invalid_case', `节律 ${JSON.stringify(a.every)} 读不成时长，写法如 "1h" / "15m"`);
  }
  const from = a.from === undefined ? 0 : toMs(a.from);
  const to = toMs(a.to);
  if (from === null || to === null) {
    return unknown('invalid_case', `时间窗读不成：from=${JSON.stringify(a.from)} to=${JSON.stringify(a.to)}`);
  }
  if (to < from) {
    return unknown('invalid_case', `时间窗倒置：from=${from} 晚于 to=${to}`);
  }
  const tol = Number.isFinite(a.tolerance_ms) ? a.tolerance_ms : 0;
  if (tol < 0) {
    return unknown(
      'invalid_case',
      `tolerance_ms 不能是负数（收到 ${a.tolerance_ms}）：负容差把每一行都算成跑偏。校验层拦它，求值器也不替它背书`,
    );
  }

  const sel = selectEntities(view, a.selector ?? { collection: 'runs' });
  if (sel.status === 'missing') return unknown('missing_observation', sel.reason);
  if (sel.status === 'invalid') return unknown('invalid_case', sel.reason);

  const field = a.field ?? 'scheduledFor';
  const ignore = new Set(Array.isArray(a.ignore_status) ? a.ignore_status : []);

  // 先按公式算个数，再决定造不造数组。守卫原来放在循环后面：
  // 「每毫秒一次、窗口一小时」要先空转三百六十万圈才被告知写错了，
  // 「窗口一年」则直接把进程拖死 —— 用一个写错的案例打死判决器，本身就是 bug。
  const slotCount = Math.floor((to - from) / every) + 1;
  if (slotCount > MAX_SLOTS) {
    return unknown(
      'invalid_case',
      `窗口内槽位 ${slotCount} 个，超过 ${MAX_SLOTS}：节律或窗口写错了，先改案例再谈判决`,
    );
  }
  const slots = [];
  for (let t = from; t <= to; t += every) slots.push(t);

  // 每一行运行记录必须落在某个槽位的容差内；落在两个槽位之间（或容差外）算漂移。
  // 窗口边界必须是半开区间 [from, to)：to 是「到这一刻为止」，不包含这一刻之后。
  // 先前写成 [from, to] 并额外放行 to + every，结果是相邻两段窗口互相把对方的
  // 行算成「落在窗口外」——暂停被切成两段时必然踩到。
  // 只判窗口内的行：窗口外的行属于别的窗口（暂停把时间线切成两段时必然出现），
  // 把它们算成「越界」等于让两段窗口互相指控。多跑的那一次由 count_delta 或
  // event_absent 抓——一条断言只回答一个问题。
  const seen = new Map(); // slotIndex -> row
  const driftedSlots = new Set();
  const drifted = [];
  for (const row of sel.rows) {
    const at = toMs(getPath(row, field));
    if (at === null) {
      return unknown(
        'missing_observation',
        `运行记录缺时间戳（${field}）：${JSON.stringify(getPath(row, field))} —— 看不见不等于没跑`,
      );
    }
    const status = a.status_field ? getPath(row, a.status_field) : undefined;
    if (status !== undefined && ignore.has(status)) continue;
    // 容差既是「允许晚一点」也是「允许落在窗口边界外一点点」：
    // 00:45 那一跑晚到 00:50，它仍然属于 00:45 这个槽位。
    // 只按 [from, to] 剪掉，会把「跑偏」误报成「漏跑」。
    if (at < from - tol || at > to + tol) continue;
    const k = Math.round((at - from) / every);
    if (k < 0 || k >= slots.length) continue;
    if (Math.abs(at - (from + k * every)) > tol) {
      // 先记成「这个槽位跑偏了」。它既不算填满，也不算漏跑——
      // 把跑偏的行当成漏跑，报告里就会出现「漏了 4 个槽位」这种
      // 既不准确、又让人找错方向的结论。
      driftedSlots.add(k);
      drifted.push(at);
      continue;
    }
    // 槽位曾经跑偏、现在来了一次准点的：准点行把槽位填上（seen），
    // 跑偏记录照旧留着。旧代码在这里把准点行记成第二次跑偏、再把槽位
    // 从跑偏集合里删掉 —— 同一个槽位同时变成「跑偏两次」和「漏跑一次」，
    // 两笔都错：真相是一次跑偏加一次准点。
    if (seen.has(k)) {
      return bad(
        'recurrence_duplicated',
        `第 ${k + 1} 个槽位跑了两次：${new Date(seen.get(k)).toISOString()} 与 ${new Date(at).toISOString()}`,
      );
    }
    seen.set(k, at);
  }

  const missing = [];
  for (let k = 0; k < slots.length; k += 1) if (!seen.has(k) && !driftedSlots.has(k)) missing.push(k);

  if (a.expect_count !== undefined && seen.size !== a.expect_count) {
    return bad(
      'recurrence_count_mismatch',
      `窗口内命中 ${seen.size} 个槽位，案例要求 ${a.expect_count} 个（槽位共 ${slots.length} 个）`,
    );
  }
  if (drifted.length > 0) {
    return bad(
      'recurrence_drift',
      `有 ${drifted.length} 次跑偏了槽位（容差 ${tol}ms）：${drifted
        .slice(0, 3)
        .map((t) => new Date(t).toISOString())
        .join('、')}`,
    );
  }
  if (missing.length > 0) {
    const list = missing.slice(0, 5).map((k) => `#${k + 1}@${new Date(from + k * every).toISOString()}`);
    const more = missing.length > 5 ? ` 等 ${missing.length} 个` : '';
    return bad(
      'recurrence_gap',
      `漏跑 ${missing.length} 个槽位：${list.join('、')}${more}（节律 ${a.every}，窗口 ${slots.length} 个槽位）`,
    );
  }
  return {
    status: 'true',
    code: 'ok',
    message: `${describeSelector(a.selector ?? { collection: 'runs' })} 在 ${slots.length} 个槽位上按 ${a.every} 跑满，无漏无重`,
  };
}

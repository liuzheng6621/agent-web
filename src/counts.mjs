// 轨迹计数：只数，不判。
//
// 为什么单独一个文件：这一层最容易长出「评分」。一旦给一条轨迹打 78 分，
// 就得先定义 78 分意味着什么、谁有权定义、跨域怎么对齐——那是另一个研究项目，
// 而且会把「合法判决」和「流程好坏」混成一件事（见 LIMITS L3，状态 by-design）。
//
// 所以这里只有五个数，每个都写清定义，任何一个都能被手工复算。
// 想加「综合得分」的人请先读 src/counts.mjs 的这段注释和 test/report-counts.test.mjs。

import { stableStringify } from './values.mjs';

export const COUNTS_VERSION = 'agent-web/counts-1';

// 读能力的兜底判断（拿不到 manifest 时用）。拿到 manifest 就按 kind 字段走。
const READ_HINT = /\.(list|get|search|find|observe|view|show|read|feed|count|stats|tags)$/;
const READ_HINT_PREFIX = /(^|\.)(list|get|search|find|observe|view|show|read|feed|count|stats)(\.|$)/;

// 「撤销」的配对表：左边做了一件事，右边把它撤了。只在**后者引用了前者的产出**时才算，
// 否则「删一条别的订单」会被误记成撤销。
const REVERSAL_OF = {
  'order.create': /\.(delete|cancel|remove)$/,
  'article.create': /\.(delete|remove)$/,
  'comment.create': /\.(delete|remove)$/,
  'note.create': /\.(delete|remove)$/,
  'task.create': /\.(delete|remove|cancel)$/,
  'favorite.add': /\.(remove|unfavorite)$/,
  'follow.add': /\.(remove|unfollow)$/,
};

/** 把一步的参数摊平成一串字符串，方便找 `$s1.orderId` 这种引用。 */
function refsIn(value, out = []) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\$([A-Za-z0-9_-]+)\b/g)) out.push(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) refsIn(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) refsIn(v, out);
  }
  return out;
}

function isRead(capability, reads) {
  if (reads && typeof reads.has === 'function') return reads.has(capability);
  return READ_HINT.test(capability) || READ_HINT_PREFIX.test(capability);
}

/**
 * 数一条轨迹。steps 是 evidence.trace（或案例的 reference_trajectory）。
 * 返回的五个键就是全部输出——**不许加第六个**，加了就等于偷偷引入了一个新指标。
 */
export function countTrajectory(steps = [], { reads = null, referenceSteps = null } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const n = list.length;

  // 1) 重复读：同一读能力 + 同一参数，出现了不止一次。多出来的那次记 1。
  const seen = new Map();
  let repeatReads = 0;
  for (const s of list) {
    if (!isRead(s.capability, reads)) continue;
    const key = `${s.capability}|${stableStringify(s.arguments ?? null)}`;
    const hit = seen.get(key) ?? 0;
    if (hit > 0) repeatReads += 1;
    seen.set(key, hit + 1);
  }

  // 2) 重试：同一能力 + 同一参数，上一次没成（不是 applied），而这次期望它成。
  let retries = 0;
  for (let i = 1; i < n; i += 1) {
    const prev = list[i - 1];
    const cur = list[i];
    if (prev.capability !== cur.capability) continue;
    if (stableStringify(prev.arguments ?? null) !== stableStringify(cur.arguments ?? null)) continue;
    const failedBefore = prev.outcome !== 'applied';
    if (failedBefore && (cur.expected_outcome ?? 'applied') === 'applied') retries += 1;
  }

  // 3) 撤销的写：某次写的产出被后面一步引用，而那一步正是它的反操作。
  let wastedWrites = 0;
  for (let i = 0; i < n; i += 1) {
    const cap = list[i].capability;
    const revRe = REVERSAL_OF[cap];
    const generic = !revRe;
    for (let j = i + 1; j < n; j += 1) {
      const later = list[j];
      if (!refsIn(later.arguments ?? null).includes(list[i].id)) continue;
      const matched = generic ? false : revRe.test(later.capability);
      if (matched) { wastedWrites += 1; break; }
    }
  }

  // 4) 绕路比 = 实走步数 / 案例参考轨迹的步数。
  // 分母必须是**案例里那条参考轨迹**的长度：它就是这份案例认为「够用」的路径，
  // 也是它的依赖图（每一步的产出都被后面的步骤按 `$sN` 引用）。
  // 没有参考轨迹（比如只拿了一份 results.jsonl）时记 null 而不是 0 或 1——
  // 分母不知道就写「不知道」，编一个数出来比不给更糟。
  const detourRatio = Number.isInteger(referenceSteps) && referenceSteps > 0
    ? Number((n / referenceSteps).toFixed(2))
    : null;

  return {
    steps: n,
    repeat_reads: repeatReads,
    detour_ratio: detourRatio,
    wasted_writes: wastedWrites,
    retries,
  };
}

export const COUNT_KEYS = ['steps', 'repeat_reads', 'detour_ratio', 'wasted_writes', 'retries'];

/** 文本输出：表格 + 一行定义。不放形容词，形容词是评分的入口。 */
export function formatCounts(rows) {
  const head = ['案例', '步数', '重复读', '绕路比', '撤销的写', '重试'];
  const body = rows.map((r) => [
    r.case_id,
    String(r.counts.steps),
    String(r.counts.repeat_reads),
    r.counts.detour_ratio === null ? '-' : String(r.counts.detour_ratio),
    String(r.counts.wasted_writes),
    String(r.counts.retries),
  ]);
  const total = rows.reduce((acc, r) => {
    acc.steps += r.counts.steps;
    acc.repeat_reads += r.counts.repeat_reads;
    acc.wasted_writes += r.counts.wasted_writes;
    acc.retries += r.counts.retries;
    return acc;
  }, { steps: 0, repeat_reads: 0, wasted_writes: 0, retries: 0 });
  const ratioAll = rows.every((r) => r.counts.detour_ratio === null)
    ? '-'
    : String(Number(rows.reduce((a, r) => a + (r.counts.detour_ratio ?? 1), 0).toFixed(2)));
  body.push(['合计', String(total.steps), String(total.repeat_reads), ratioAll,
    String(total.wasted_writes), String(total.retries)]);

  const widths = head.map((h, i) => Math.max(displayWidth(h), ...body.map((row) => displayWidth(row[i]))));
  const line = (cells) => cells.map((c, i) => (i === 0 ? padRight(c, widths[i]) : padLeft(c, widths[i]))).join('  ');
  const out = [];
  out.push('轨迹计数（只数不判，不参与 pass/fail/unknown）');
  out.push('');
  out.push(line(head));
  out.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of body) out.push(line(row));
  out.push('');
  out.push('定义：步数=轨迹长度；重复读=同一读能力同一参数多读的次数；');
  out.push('      绕路比=实走步数/案例参考轨迹步数（没给 --cases 时记为 -，不猜）；');
  out.push('      撤销的写=写之后又用它的产出做了它的反操作；重试=同一能力同一参数失败后再来一次。');
  out.push('这五个数是事实，不是评价。要不要改、改哪里，由读的人决定。');
  return out.join('\n');
}

// 中文字符按两格算，表格才对得齐。
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += /[\u2e80-\ua4cf\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return w;
}
function padRight(s, w) {
  const d = w - displayWidth(s);
  return String(s) + ' '.repeat(d > 0 ? d : 0);
}
function padLeft(s, w) {
  const d = w - displayWidth(s);
  return ' '.repeat(d > 0 ? d : 0) + String(s);
}

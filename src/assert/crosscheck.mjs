/**
 * 交叉复核（L8 的一半）。
 *
 * 适配器可以撒谎：它知道自己被探测，所以能骗过探针。
 * 但有一件事它骗不过去——**同一时刻，两个通道看到的东西不一样**。
 *
 * 所以这里不做沙箱（进程隔离拦不住铁了心的适配器，写了反而给人虚假安全感），
 * 只做一件事：让「走 HTTP 的适配器」有一个可机检的交叉证据。
 *
 * 三类结论，缺一不可：
 *   consistent   两个通道拿到同一个响应 —— 这条能力的可信度升级
 *   divergent    两边不一样 —— 适配器在撒谎，或者中间有缓存
 *   uncheckable  适配器不走 HTTP —— 明确说「查不了」，**不能算通过**
 *
 * 把「查不了」记成「没问题」是这类工具最容易犯的错，所以 uncheckable 单列，
 * 且默认让退出码非 0。
 */

export const CROSSCHECK_VERSION = 'agent-web/crosscheck-1';

/** 从规范视图的某个集合里取出可复现的请求：只认「读」能力，写能力会改状态，复核不了。 */
export const READ_METHODS = Object.freeze(['GET']);

/**
 * 一次响应的指纹。只取「形状 + 关键值」，不取时间戳与自增 id 这类每次都变的东西。
 *
 * 为什么不能直接比整段 JSON：`at`、`id`、`createdAt` 每次都不一样，
 * 直接比会让**正确实现也判 divergent**，那这个检测器就成了噪声源。
 */
export function fingerprintOf(body, { volatile = DEFAULT_VOLATILE } = {}) {
  const canon = (v) => {
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) return v.map(canon);
    if (typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (volatile.includes(k)) continue;
        out[k] = canon(v[k]);
      }
      return out;
    }
    return v;
  };
  return stableStringify(canon(body));
}

/** 默认视为「每次都变」的字段。名字匹配即可，不递归进对象内部判语义。 */
export const DEFAULT_VOLATILE = Object.freeze([
  'at', 'time', 'timestamp', 'createdAt', 'updatedAt', 'createTime', 'updateTime',
  'id', 'key', 'token', 'nonce', 'requestId', 'traceId', 'etag', 'date',
]);

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/**
 * 判定一条能力的复核结果。
 *
 * @param {object} args
 * @param {boolean} args.httpAdapter  适配器是否走 HTTP
 * @param {*} args.viaAdapter         经过适配器拿到的响应体
 * @param {*} args.viaDirect          独立通道拿到的响应体
 * @param {string} [args.reason]      不走 HTTP 时说明理由
 */
export function verdictOf({ httpAdapter, viaAdapter, viaDirect, reason, volatile }) {
  if (!httpAdapter) {
    return {
      status: 'uncheckable',
      code: 'not_http',
      message: reason || '适配器不走 HTTP，这条路查不了',
    };
  }
  if (viaAdapter === undefined || viaDirect === undefined) {
    return {
      status: 'uncheckable',
      code: 'missing_response',
      message: '有一个通道没拿到响应：拿不到就不能声称一致',
    };
  }
  const a = fingerprintOf(viaAdapter, { volatile });
  const b = fingerprintOf(viaDirect, { volatile });
  if (a === b) return { status: 'consistent', code: 'ok', message: '两个通道拿到同一个响应' };
  return {
    status: 'divergent',
    code: 'response_mismatch',
    message: '两个通道拿到的响应不同',
    adapter: a,
    direct: b,
  };
}

/**
 * 汇总。退出码规则写在这里，不在 CLI 里：
 *   divergent 存在 → 1（有证据表明适配器在撒谎）
 *   全部 consistent → 0
 *   其余（含全部 uncheckable）→ 2（查不了不等于没问题，但也不是抓到了谎）
 */
export function exitOf(rows) {
  const divergent = rows.filter((r) => r.status === 'divergent').length;
  if (divergent > 0) return 1;
  const consistent = rows.filter((r) => r.status === 'consistent').length;
  if (consistent === rows.length && rows.length > 0) return 0;
  return 2;
}

export function summarize(rows) {
  const counts = { consistent: 0, divergent: 0, uncheckable: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    total: rows.length,
    ...counts,
    // 「查得了几条」比「几条一致」更有意义：分母不该把查不了的算进去。
    checkable: counts.consistent + counts.divergent,
    rate: counts.consistent + counts.divergent === 0
      ? null
      : counts.consistent / (counts.consistent + counts.divergent),
  };
}

export function formatCrosscheck(report) {
  const s = report.summary;
  const out = [];
  out.push(`交叉复核 · 适配器 ${report.adapter} · ${s.total} 条能力`);
  if (s.total === 0) {
    out.push('');
    out.push('  一条可复核的能力都没有。走 HTTP 的适配器至少要有几个只读能力才谈得上复核。');
    return out.join('\n');
  }
  out.push('');
  for (const r of report.rows) {
    const mark = r.status === 'consistent' ? '一致' : r.status === 'divergent' ? '不一致' : '查不了';
    out.push(`  [${mark}] ${String(r.capability).padEnd(24)} ${r.message}`);
    if (r.status === 'divergent') {
      out.push(`      经适配器：${String(r.adapter).slice(0, 90)}`);
      out.push(`      独立通道：${String(r.direct).slice(0, 90)}`);
    }
  }
  out.push('');
  out.push(`  一致 ${s.consistent} · 不一致 ${s.divergent} · 查不了 ${s.uncheckable}`);
  if (s.checkable > 0) {
    out.push(`  可复核的 ${s.checkable} 条里一致 ${s.consistent} 条（${Math.round(s.rate * 1000) / 10}%）`);
  } else {
    out.push('  **一条都查不了**：这不是「没问题」，是「没有证据」。');
  }
  out.push('');
  out.push('  进程隔离不是安全边界：适配器可以起子进程、读文件、发网络。');
  out.push('  这条只做一件事——让走 HTTP 的适配器有一个可机检的交叉证据。');
  return out.join('\n');
}

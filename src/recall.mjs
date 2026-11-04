// recall：拿这次扫到的信号，去比对事故档案里记过的坑。
//
// 只做机械比对，不做语义相似。命中靠三层：检测项 id、见证路径、结构标签。
// 默认要求检测项 id 完全一致；--loose 才退到见证路径的通配匹配。
//
// 「加深记忆」在这里是个可验证的动作，不是权重：
//   第一次见到 → 提示
//   第二次见到 → 拦下来（退出码 1），除非显式 --no-gate
// 记的是次数，不是感觉。

import fs from 'node:fs';
import path from 'node:path';
import { ENTRIES, KNOWLEDGE_VERSION } from '../knowledge/index.mjs';
import { fingerprint as fpOf, stableStringify } from './values.mjs';

export const RECALL_VERSION = 'agent-web/recall-1';
// 只有这三类前缀能被一次实跑直接扫出来；其余（test/ci/lint）靠 CI 守着，
// recall 不会自动命中它们，报告里会单列出来，免得让人以为它们没人管。
export const SCANNABLE = ['certify:', 'probe:', 'traps:' ];
export const STATE_DIR = '.agent-web';
export const STATE_FILE = 'recall.json';

const NL = String.fromCharCode(10);

// 见证路径匹配：* 吃零到多段（真正的 glob 语义，不是"少一段"的补丁）。
// 括号段 (a|b|*At) 是选择，*At 表示后缀匹配。
export function witnessMatches(pattern, witness) {
  const p = String(pattern || '').split('.');
  const w = String(witness || '').split('.');
  const segOk = (pat, seg) => {
    if (pat === '*') return true;
    if (pat.startsWith('(') && pat.endsWith(')')) {
      return pat.slice(1, -1).split('|').some((a) => (a.startsWith('*') ? seg.endsWith(a.slice(1)) : seg === a));
    }
    return pat === seg;
  };
  const go = (i, j) => {
    if (i === p.length) return j === w.length;
    if (p[i] === '*') {
      for (let k = j; k <= w.length; k += 1) if (go(i + 1, k)) return true;
      return false;
    }
    if (j >= w.length) return false;
    return segOk(p[i], w[j]) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

/** 从一次扫描结果里收集信号：{ detector, witness, detail } */
export function signalsFromCertify(report) {
  const out = [];
  for (const m of report.mutations || []) {
    if (m.caught) continue;
    const w = m.witness?.path || '';
    out.push({ detector: 'certify:' + m.id, witness: w, detail: m.status + (w ? ' @ ' + w : '') });
  }
  return out;
}

export function signalsFromProbe(report) {
  const out = [];
  for (const c of report.checks || []) {
    if (c.status !== 'fail') continue;
    out.push({ detector: 'probe:' + c.id, witness: c.id, detail: c.message || '' });
  }
  return out;
}

export function signalsFromTraps(report) {
  const out = [];
  for (const t of report.traps || []) {
    if (!t.blind) continue;
    out.push({ detector: 'traps:' + t.id, witness: t.id, detail: `盲区 ${t.blind}` });
  }
  return out;
}

/** 拿信号比对档案，返回命中与未命中。 */
export function recallSignals(signals, { loose = false, entries = ENTRIES } = {}) {
  const hits = [];
  const unseen = [];
  const used = new Set();
  for (const s of signals) {
    let hit = entries.filter((e) => e.guard.kind !== 'none' && e.fingerprint.detector === s.detector);
    let how = 'detector';
    if (hit.length === 0 && loose) {
      hit = entries.filter((e) => witnessMatches(e.fingerprint.witness, s.witness));
      how = 'witness';
    }
    if (hit.length === 0) {
      unseen.push(s);
      continue;
    }
    for (const e of hit) {
      used.add(e.id);
      hits.push({ entryId: e.id, title: e.title, how, signal: s, fix: e.fix, guard: e.guard });
    }
  }
  return { hits, unseen, matchedIds: [...used].sort() };
}

export function loadState(root) {
  const p = path.join(root, STATE_DIR, STATE_FILE);
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (j && typeof j.counts === 'object') return { path: p, counts: j.counts, runs: j.runs || 0 };
  } catch {
    /* 第一次跑，没有状态文件是正常的 */
  }
  return { path: p, counts: {}, runs: 0 };
}

export function saveState(root, state) {
  const dir = path.join(root, STATE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(state.path, JSON.stringify({ version: RECALL_VERSION, ...state }, null, 2) + NL, 'utf8');
}

/** 累计次数：这次命中的条目 +1。返回每条的新旧计数。 */
export function bump(state, matchedIds) {
  const rows = [];
  for (const id of matchedIds) {
    const before = state.counts[id] || 0;
    state.counts[id] = before + 1;
    rows.push({ entryId: id, before, after: state.counts[id], gate: state.counts[id] >= 2 });
  }
  state.runs += 1;
  return rows;
}

export function recallExit(rows, { noGate = false } = {}) {
  if (noGate) return 0;
  return rows.some((r) => r.gate) ? 1 : 0;
}

export function formatRecall(result, { rows = [], root = '', entries = ENTRIES } = {}) {
  const L = [];
  L.push(`事故档案 ${KNOWLEDGE_VERSION} · 本次扫描命中 ${result.hits.length} 条`);
  if (result.hits.length === 0) {
    L.push('  这次没撞上档案里的坑。');
  }
  for (const h of result.hits) {
    const r = rows.find((x) => x.entryId === h.entryId);
    const nth = r ? r.after : 1;
    const tag = nth >= 2 ? `第 ${nth} 次` : '第一次';
    L.push('');
    L.push(`  ${h.entryId}  ${tag}  ${h.title}`);
    L.push(`    信号：${h.signal.detector}${h.signal.detail ? '  ' + h.signal.detail : ''}`);
    L.push(`    当时怎么修的：${h.fix}`);
    L.push(`    判据落在：${h.guard.kind} ${h.guard.ref}`);
    if (nth >= 2) L.push('    → 这条已经犯过，按规矩拦下来（--no-gate 可放过）');
  }
  const offArchive = entries.filter((e) => !SCANNABLE.some((p) => e.fingerprint.detector.startsWith(p)));
  if (offArchive.length > 0) {
    L.push('');
    L.push(`  另有 ${offArchive.length} 条档案不靠这条命令守（由 CI / 单测兜底）：`);
    for (const e of offArchive) L.push(`    ${e.id}  → ${e.guard.kind} ${e.guard.ref}`);
  }

  if (result.unseen.length > 0) {
    L.push('');
    L.push(`  档案里没有的 ${result.unseen.length} 条信号（可能是新坑）：`);
    for (const s of result.unseen) L.push(`    ${s.detector}${s.detail ? '  ' + s.detail : ''}`);
    L.push('    → 确认是新坑后，按 knowledge/README 的格式补一条，并在 guard 里写清判据');
  }
  if (root) L.push('', `  状态文件：${path.join(STATE_DIR, STATE_FILE)}`);
  return L.join(NL);
}

export function recallSignature(result) {
  return 'fnv1a32:' + fpOf(stableStringify(result.matchedIds)).slice('fnv1a32:'.length);
}

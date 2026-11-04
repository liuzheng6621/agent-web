export const e06 = {
  id: 'k-severity-as-status',
  title: '探针把「失败算多重」当成了「现在失不失败」',
  symptom: '六项检查全部通过，报告却写着 6 项失败。',
  cause:
    '每个检查项带 severity（万一失败算 fail 还是 warn），报告用 ' +
    "checks.filter(c => c.severity === FAIL) 计数，把所有项都算成了失败。",
  fix: '按 c.status 过滤，severity 只在决定汇总退出码时读。',
  fingerprint: {
    structure: 'report/aggregation:status_field_confused',
    witness: 'report.checks.*',
    detector: 'test:all-pass-means-zero-failed',
  },
  first_seen: {
    commit: '81d273f',
    date: '2026-11-04',
    evidence: 'agent-web probe --adapter=memory 首跑报 6 项失败，实际 6/6 通过',
  },
  guard: { kind: 'test', ref: 'test/probe.test.mjs 的「全通过时 failed 必须为 0」' },
  repro: 'agent-web probe --adapter=memory  —— 全通过时 exit 必须是 0',
  recurred: 0,
};

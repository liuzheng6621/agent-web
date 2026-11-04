export const e04 = {
  id: 'k-parallel-verdict-drift',
  title: '把评估改成并发，快了九倍，答案也变了',
  symptom:
    '同一个变异体，串行时「被第 4 条断言抓住」，6 并发时变成「判决级 ×3」；' +
    '另一个变异体从欠账变成漏网；建议值从 id=1 变成 id=137。',
  cause:
    '并发把「同一台机器上的时序」放进了被测系统。复位靠新建账号、观测靠列表分页，' +
    '两批案例同时跑就会互相看见对方的订单。',
  fix:
    '撤回并发代码，不提供 --jobs。串行连跑两次逐字相同，这是跨实现对照能成立的前提。',
  fingerprint: {
    structure: 'run/determinism:unstable_verdict',
    witness: 'verdict.*',
    detector: 'drift:same-input-twice',
  },
  first_seen: {
    commit: '81d273f',
    date: '2026-11-04',
    evidence: 'docs/SPEC.md 12.9.2 —— 串行 77 秒、6 并发 8 秒，但结论漂移',
  },
  guard: { kind: 'ci', ref: 'scripts/certify-baseline.mjs 固定漏网名单：多一个或少一个都判红' },
  repro:
    '对同一批案例跑两次 certify，比较两份 JSON 的 mutations[].killedBy；串行应逐字相同',
  recurred: 0,
};

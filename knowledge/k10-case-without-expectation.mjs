export const e10 = {
  id: 'k-case-without-expectation',
  title: '案例加了，预期表没加',
  symptom:
    'selftest 里那行前面是个「·」而不是「✓」，但整批照样退出 0。' +
    '两个月后跑 verify，才发现「1 条案例没有在 expected.json 里声明预期」。',
  cause:
    'two-items 是加 two-items 那次提交只写了案例、没写 expected.json。' +
    'selftest 的设计是「跑全部并报全貌」，未声明的案例只画个点不算失败——' +
    '这个宽松在单次冒烟里合理，在 CI 里就是放水。',
  fix:
    'CI 加一步「数一遍」：案例文件的 id 集合与 expected.json 的键集合必须完全相等，' +
    '多一个少一个都红。宽松留给本地，严格留给流水线。',
  fingerprint: {
    structure: 'suite/expectation:missing-entry',
    witness: 'cases/*/expected.json',
    detector: 'ci:expected-covers-all-cases',
  },
  first_seen: { commit: '51339dc', date: '2026-11-04' },
  guard: { kind: 'test', ref: 'test/engine.test.mjs 的「每个案例都在 expected.json 里有预期」+ CI 同名步骤' },
  repro: 'node bin/agent-web.mjs selftest   # 看有没有行首是「·」而不是「✓」的',
};

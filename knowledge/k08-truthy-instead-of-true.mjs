export const e08 = {
  id: 'k-truthy-instead-of-true',
  title: '三值常量写成 TRUE，13 条断言全被判「不成立」',
  symptom: 'certify 第一轮报「全部断言在正确实现上就不成立、0 条能求值」。',
  cause:
    "三值常量是小写字符串（TRUE='true'），比较时写了 JS 的 true/大写 TRUE，" +
    '断言求值结果全部落不进判据，被判成 unarmed。',
  fix:
    '统一用 three-valued.mjs 导出的常量比较，不再手写字面量；' +
    'certify 报「unarmed 数 > 0」时不允许给满分，避免静默空转。',
  fingerprint: {
    structure: 'assert/eval:value_mismatch',
    witness: 'assert.*.status',
    detector: 'certify:unarmed-count',
  },
  first_seen: {
    commit: '2e2c074',
    date: '2026-11-04',
    evidence: 'certify 首跑 13 条断言全 unarmed，修正常量后 12 条能求值 7 条有效',
  },
  guard: { kind: 'certify', ref: 'src/three-valued.mjs 常量 + certify 的 unarmed 计数' },
  repro: 'agent-web certify cases/coffee --adapter=memory  —— unarmed 数应为 0',
  recurred: 0,
};

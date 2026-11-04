export const e01 = {
  id: 'k-identity-collapse',
  title: '适配器把「谁来做」悄悄换成了别人',
  symptom:
    '案例写着让 customer2 去取别人的订单，判决却是 pass（正常应该 fail）。',
  cause:
    '迁移分支按「走店员线还是顾客线」选令牌，忽略了案例里的 action.as。' +
    '身份在适配器里被塌缩成两个（staff / customer），customer2 被静默当成 customer 执行。',
  fix:
    '令牌一律取自 who.token 而不是 ctx.customer.token；reset 额外返回 roleBindings，' +
    '由 runner 检查角色到身份的映射是单射（两个角色指向同一身份即 invalid_environment）。',
  fingerprint: {
    structure: 'execute/binding:unexpected_pass',
    witness: 'trace.*.identity',
    detector: 'traps:identity-collapse',
  },
  first_seen: {
    commit: '95b8f7c',
    date: '2026-11-04',
    evidence: 'docs/FINDING-001.md —— 三值逻辑抓不到这一类，抓到它的是跨实现判决对照',
  },
  guard: { kind: 'certify', ref: 'docs/museum/e01-identity-collapse.mjs + src/runner.mjs 的 roleBindings 单射检查' },
  repro:
    'node -e "import(\'./docs/museum\').then(m=>m.default.runAll())" —— e01 展品复现塌缩与不塌缩两种判决',
  recurred: 0,
};

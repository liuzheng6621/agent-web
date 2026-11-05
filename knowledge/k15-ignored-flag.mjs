export const e15 = {
  id: 'k-ignored-flag',
  title: '命令行参数被无视，报出的数字不是它说的那个',
  symptom:
    'selftest --adapter=taixianglian 输出「10/10 与预期一致」，但那条命令实际跑的是内存适配器——真实后端一次都没碰。于是「真实后端也一致」这个结论从来没被量过。',
  cause:
    'cmdSelftest 里写死了 makeAdapter(\'memory\') 与 adapterName: \'memory\'，flags.adapter 从头到尾没被读过。别的子命令都读，只有这一条漏了，所以「同一个 flag 在别的命令上有效」这种经验在这里正好骗人。',
  fix:
    '改成 const adapterName = flags.adapter ? String(flags.adapter) : \'memory\'，并把它同时传给 makeAdapter 与 runOne。修完真实后端第一次跑出真实数字（10/10，与内存适配器一致，但这次是真的）。',
  fingerprint: {
    structure: 'cli/flag:silently_ignored',
    witness: 'verdict.*.adapter',
    detector: 'test:selftest-honors-adapter',
  },
  first_seen: { commit: '00475a4', date: '2026-11-05' },
  guard: { kind: 'test', ref: 'test/cli-flags.test.mjs（--adapter 必须真的改变被加载的适配器）' },
  repro: 'node bin/agent-web.mjs selftest --adapter=test/fixtures/adapter-stub.mjs',
};

export const e11 = {
  id: 'k-version-tri-truth',
  title: '同一个版本号在三处各说各话',
  symptom:
    '有人来问「现在是什么版本」，答案取决于问谁：package.json 说 0.16，README 说 0.9，' +
    'Gitee 的 Release 页说 v0.6.0。三个数都对，都是「某个时刻的真相」。',
  cause:
    '每加一个版本，只改了其中一处。README 里的数字是从 0.9 那次手写进去的，之后再没动；' +
    'Release 只在 0.6.0 发过一次；package.json 跟着代码走。三处没有一处是「真相」，' +
    '只有三份各自过期的副本。',
  fix:
    '版本唯一来源定为 package.json：CLI 加 --version 直接读它，CHANGELOG 首条必须与它一致，' +
    '测试与 CI 各查一遍。README 里不再写版本数字——不写就不会过期。',
  fingerprint: {
    structure: 'meta/version:multiple-sources',
    witness: 'package.json',
    detector: 'test:version-single-source',
  },
  first_seen: { commit: '1b541b3', date: '2026-11-04' },
  guard: { kind: 'test', ref: 'test/engine.test.mjs 的「版本号只有一处真相」+ CI 同名步骤' },
  repro: 'node bin/agent-web.mjs --version && grep -m1 -oE "^## [0-9.]+" CHANGELOG.md && node -p "require(\'./package.json\').version"',
};

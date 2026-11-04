export const e07 = {
  id: 'k-test-not-in-script',
  title: '新写的测试文件没进 scripts.test，等于没写',
  symptom: '新增了 test/drill.test.mjs，npm test 仍然报 87 个用例，一个都没跑。',
  cause:
    'package.json 的 scripts.test 是显式列出测试文件，不是通配。' +
    '加了文件忘了加进列表，测试文件就静悄悄地待在仓库里。',
  fix:
    '把新文件加进 scripts.test；并加一条元测试，比对 test/*.test.mjs 与脚本里列出的清单。',
  fingerprint: {
    structure: 'repo/ci:unlisted_test_file',
    witness: 'package.json:scripts.test',
    detector: 'test:test-file-inventory',
  },
  first_seen: {
    commit: '07dc21b',
    date: '2026-11-04',
    evidence: '加入 test/drill.test.mjs 后测试数仍为 87，排查后改 scripts.test 才变 94',
  },
  guard: { kind: 'test', ref: 'package.json 的 scripts.test 显式清单' },
  repro: 'npm test 的用例数应当等于 test/*.test.mjs 里的 test() 总数',
  recurred: 0,
};

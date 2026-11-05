export const e14 = {
  id: 'k-tag-intermediate-state',
  title: '把「还没打 tag」判成错，等于每次发版都先红一次',
  symptom:
    'CI 连续三次红在同一步「README 状态行必须与代码一致」，而本地跑同一条命令全绿。',
  cause:
    '状态行脚本要求 git tag 里必须有 v<当前版本>。可发版的正常顺序是先推 main、CI 绿了再打 tag——' +
    '这个中间态被算成了错。CI 检出时带着上一版及更早的 tag，于是「tag 集合非空但没有当前版本」这条成立，' +
    '直接判红。本地之所以绿，是因为本地早就打过 tag 了。',
  fix:
    '缺当前版本 tag 默认只提醒（stderr 一行「提醒（不算错）」），发版流程用 --require-tag 把它变回硬错。' +
    '规则本身没弱：错的是把「顺序中间的合法状态」当成「漂移」。',
  fingerprint: {
    structure: 'ci/failure:only-in-ci, local-green, step:status-line',
    witness: 'git tag --list',
    detector: 'ci:status-line',
  },
  first_seen: { commit: 'f433197', date: '2026-11-05' },
  guard: { kind: 'ci', ref: 'scripts/status-line.mjs --require-tag（发版时）/ 默认提醒（CI）' },
  repro: '删掉当前版本的 tag（git tag -d）后跑 node scripts/status-line.mjs：默认退出 0 并在 stderr 给一句提醒；加 --require-tag 则退出 1。',
};

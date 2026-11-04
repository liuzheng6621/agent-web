export const e05 = {
  id: 'k-gitignore-swallows-examples',
  title: '.gitignore 写 drills/，把 examples/drills/ 一起吃掉了',
  symptom:
    'CI 里的「好提交必须满分」这一步在本地永远绿，新克隆的仓库必然挂。',
  cause:
    '.gitignore 的 drills/ 不带前导斜杠，git 会匹配任意层级的同名目录，' +
    '于是 examples/drills/ 也被忽略。git status 干净，看不见少东西。',
  fix: '改成 /drills/ 只锚定仓库根；并用 git ls-files 核对示例文件数不为 0。',
  fingerprint: {
    structure: 'repo/ignore:missing_ci_input',
    witness: '.gitignore:drills',
    detector: 'ci:git-ls-files-count',
  },
  first_seen: {
    commit: 'e29ba50',
    date: '2026-11-04',
    evidence: 'git ls-files examples/drills | wc -l 实测为 0，11 份示例提交全部没入库',
  },
  guard: { kind: 'test', ref: '.gitignore 的 /drills/ + test/drill.test.mjs 读 examples/drills' },
  repro: 'git ls-files examples/drills | wc -l  —— 该值必须大于 0',
  recurred: 0,
};

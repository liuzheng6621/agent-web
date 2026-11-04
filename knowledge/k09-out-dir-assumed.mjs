export const e09 = {
  id: 'k-out-dir-assumed',
  title: '写结果文件时假定父目录已经存在',
  symptom:
    '本地跑得好好的，一上 CI 就红；报错是 ENOENT，指向 .tmp-ci/xxx.jsonl 这种「输出路径」。',
  cause:
    'verify 的 --out 直接 writeFileSync，没有先建父目录。本地目录是前一次手工跑留下的，' +
    '干净克隆里不存在。同一个形状的坑犯过两次：上一次是 .gitignore 把 examples/drills 吞掉，' +
    '都属于「本地状态掩盖了真实依赖」。',
  fix:
    '写任何 --out 之前先 mkdirSync(path.dirname(path.resolve(out)), { recursive: true })；' +
    'CI 里同时显式 mkdir -p，两层都要有——代码修的是能力，CI 修的是可读性。',
  fingerprint: {
    structure: 'io/write:parent-dir-assumed',
    witness: '*.tmp-*/*.jsonl',
    detector: 'test:verify-out-creates-dir',
  },
  first_seen: { commit: '51339dc', date: '2026-11-04' },
  guard: { kind: 'test', ref: 'test/engine.test.mjs 的「--out 的父目录不存在时自己建出来」' },
  repro: 'git clone --depth 1 <repo> /tmp/aw && cd /tmp/aw && node bin/agent-web.mjs verify cases/coffee --adapter=memory --out=.tmp-ci/traps.jsonl',
};

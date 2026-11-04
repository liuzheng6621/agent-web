export const e12 = {
  id: 'k-login-rate-limit',
  title: '复位时每次重登，撞上自己后端的登录限流',
  symptom:
    'probe 六项里两项直接失败，理由是「login configured test admin failed with HTTP 429: '
    + '尝试次数过多，请1分钟后再试」。等一分钟再跑就全绿，过一会儿又红。'
    + '最容易得出的结论是「后端不稳定」，然后把它当成环境噪音放过。',
  cause:
    'adapters 的 reset() 每跑一次就登一次 admin。真后端对登录有频控，'
    + '而 probe 要连做两次复位来验幂等，certify 要按变异体数量跑几十次复位——'
    + '参考实现本身没毛病，是适配器把「一次运行需要的凭据」当成了「每次复位都要重新取」。'
    + '429 又被 classify 归进 infra_error，于是它表现为「环境故障」，而不是「适配器有 bug」。',
  fix:
    'admin 令牌按进程缓存，只有拿到 401 才重登。一次运行一个凭据，'
    + '复位只重建被复位的东西。改完 probe 6/6，verify 与 compare 全绿。',
  fingerprint: {
    structure: 'adapter/reset:credential-fetched-per-reset',
    witness: 'probe.checks[?(@.id=="reset")]',
    detector: 'probe:reset',
  },
  first_seen: { commit: '42ce913', date: '2026-11-04' },
  guard: { kind: 'probe', ref: 'probe 的 reset 与 reset-idempotent 两项（连做两次复位）' },
  repro:
    'ANIMAL_TEST_ISOLATED=1 ANIMAL_TEST_ADMIN_USER=admin ANIMAL_TEST_ADMIN_PASSWORD=admin123 '
    + 'node bin/agent-web.mjs probe --adapter=examples/animal-tracking/adapter.mjs --detail',
};


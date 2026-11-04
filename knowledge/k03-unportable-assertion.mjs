export const e03 = {
  id: 'k-unportable-assertion',
  title: '建议断言给出 id = 1 这种一换实现就红的条目',
  symptom:
    '--suggest 建议 field_equals id = 1，当场验证通过（同一进程里 id 就是 1），写进案例后换个实现必红。',
  cause:
    'suggestFromWitness 只看「这条差异能不能杀掉变异体」，没看这条差异换一个实现还成不成立。' +
    'id、时间戳、取餐号、用户名都由「谁先跑 / 库自增 / 时钟 / 复位方式」决定。',
  fix:
    '加 NON_PORTABLE 字段集合与 /(At|Time)$/ 后缀规则，isPortablePath 拦掉；' +
    '给不出建议时标 suggestionBlocked 并显式说明为什么给不出（沉默会被读成没找到洞）。',
  fingerprint: {
    structure: 'suggestion/portability:non_portable_field',
    witness: '*.(id|*At|pickupNo|username)',
    detector: 'certify:m-pickup-no-offset',
  },
  first_seen: {
    commit: 'd52a6d9',
    date: '2026-11-04',
    evidence: 'm-pickup-no-offset 的差异落在 orders.0.pickupNo，属不可移植，只能记成欠账',
  },
  guard: { kind: 'certify', ref: 'certify 的 suggestionBlocked + test/certify.test.mjs 的 isPortablePath 用例' },
  repro: 'agent-web certify cases/coffee --adapter=memory --suggest',
  recurred: 0,
};

export const e02 = {
  id: 'k-menu-not-aligned',
  title: '参照实现的菜单是自己编的，案例在真实后端上换了目标',
  symptom:
    '同一份案例在 mock 上判 pass，在真实后端上 unknown / infrastructure_error，报「菜单里没有 美式」。',
  cause:
    'mock 的菜单是手编的（美式、手冲），参考实现卖的是美式咖啡、太相恋特调。' +
    '案例按菜名点单，于是同一份案例在两边指的不是同一道菜。',
  fix:
    'mock 菜单逐字对齐参考实现（拿铁 28 / 美式咖啡 22 / 太相恋特调 38），' +
    '并把理由写进 memory.mjs 的注释，防止后面的人顺手改菜名。',
  fingerprint: {
    structure: 'state/normalization:infrastructure_error',
    witness: 'menu.*.dishName',
    detector: 'test:menu-parity',
  },
  first_seen: {
    commit: 'd52a6d9',
    date: '2026-11-04',
    evidence: '对齐前 memory 11/12 vs 真实后端 8/12；对齐后两边都是 11/12 且同一个漏网',
  },
  guard: { kind: 'test', ref: 'test/probe.test.mjs 的菜单对齐断言 + src/adapter/memory.mjs 的注释' },
  repro:
    'agent-web certify cases/coffee --adapter=taixianglian（菜单不对齐时 two-items 必然 infrastructure_error）',
  recurred: 0,
};

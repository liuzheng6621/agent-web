# 事故档案

这个目录存的是**这个仓库自己踩过的坑**，一条一个文件。

它解决的问题很具体：同一个错误，换个壳再来一次，上次写的检查没认出来。

## 入库条件

两样东西缺一不可：

| 要件 | 含义 |
| --- | --- |
| `repro` | 一条能跑的命令，证明它真的发生过 |
| `guard` | 一个已经落地的检查项，证明下次它会喊 |

`guard.kind = 'none'` 的条目会被 `validateEntry` 直接拒收。这不是保守，是因为只有一样东西的错误会让这个目录变成墓地：**记了，但没人管**。

## 加一条

```js
// knowledge/k09-something.mjs
export const e09 = {
  id: 'k-something-broke',
  title: '一句话说清坏在哪',
  symptom: '用户/开发者看到的现象',
  cause: '根因，写到能据此改代码的程度',
  fix: '当时怎么修的',
  fingerprint: {
    structure: '层/环节:失败类别',
    witness: 'orders.*.pickupNo',
    detector: 'certify:m-some-mutant',
  },
  first_seen: { commit: 'abc1234', date: '2026-11-05', evidence: '哪份文档或哪个数字能对上' },
  guard: { kind: 'test', ref: 'test/xxx.test.mjs 里的哪条检查' },
  repro: 'node bin/agent-web.mjs ...',
  recurred: 0,
};
```

然后在 `knowledge/index.mjs` 的 import 与 `ENTRIES` 里各加一行。`npm test` 会跑 `test/recall.test.mjs` 校验格式与宪法。

## 验证

```bash
node bin/agent-web.mjs knowledge    # 列出全部条目，并校验格式
node bin/agent-web.mjs recall       # 扫一遍当前仓库，看有没有命中
npm test                            # 含档案格式校验
```

## 收什么

- 你自己仓库里真实发生过的错误，有 commit 或文档能对上
- 判据已经落地（哪怕只是一条单测）
- 换个项目也可能重演的（不是这个项目的配置问题）

## 不收什么

- 没有复现步骤的「据说」
- 只有自然语言检查、没有机械判据的
- 找不到判据、只能靠人记住的（那属于流程，不属于档案）

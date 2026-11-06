# 词库域：两个实现，900 条数据

`cases/lexicon/` 的四条案例打这两个实现。它们**不是**同一个算法的两种写法：

| | 实现 A `lexicon-a` | 实现 B `lexicon-b` |
|---|---|---|
| 前缀索引 | 字典树（每个节点一条边表） | 按拼音排序的数组 + `lowerBound`/`upperBound` 二分定界 |
| 分词 | 正向最长匹配（贪心，词长上限 2） | 反向 DP（从末尾往前求最优切分） |
| 内部状态 | `Map<runId, {segments}>` | 同左，但分页游标按偏移算 |
| 视图 | 同一份契约 | 同一份契约 |

同一份案例喂两个实现，`compare` 判决一致率必须是 100%。两种算法在边界上分叉的地方
（前缀刚好命中 0 条、页码超过末页、分词有两种等长切法）就是案例该写死的地方。

```bash
node bin/agent-web.mjs verify  cases/lexicon --adapter=lexicon-a
node bin/agent-web.mjs verify  cases/lexicon --adapter=lexicon-b
node bin/agent-web.mjs compare cases/lexicon --adapters=lexicon-a,lexicon-b
node bin/agent-web.mjs certify cases/lexicon --adapter=lexicon-a --detail
```

实测：两个实现各 4/4 与预期一致；`compare` 判决一致率 100%、视图契约兼容；
`certify` 词库域 16 个适用变异体里抓住 10 个（62.5%）。

## 数据为什么是合成的

`dataset.mjs` 用 30 个音节两两组合生成 900 条：`id`、`word`、`pinyin`、`category`、
`strokes`、`rank` 全部由下标决定。

**不从任何公开中文词库搬数据。** 公开词库多半没有明确许可证，搬进来就等于把别人的授权
问题写进本仓库的 LICENSE。合成数据的许可证与代码一致（MIT），且完全可复现 ——
`buildLexicon()` 是纯函数，跑两次逐字段相同，判决指纹不会漂。

合成不等于随意，三个约束是硬性的：

1. **900 条**：`pageSize=10` 要能翻三页还有余量，边界丢行才有机会暴露。
2. **拼音两两不重复**：否则「前缀 `chang` 命中 30 条」这个数字会随同音字变化，案例不可复现。
3. **rank = 下标 + 1**：于是「按 rank 升序」与「按生成顺序」是同一件事，断言可以写死数字。

## 这个域补的是什么形状

前三个域（咖啡、动物、账本）的分页断言都只在个位数行上跑过。
`total` 说谎（命中 30 条却报 900）、边界丢行（每页少一行）、跨页重复这三种坏法，
在小数据上每一页都是满的，看着全绿。

词库域还顺手暴露了 `pagination` 断言自身的一个盲区：它只数各页行数，
**从不读实现自己报的 `total`**。于是「每页 10 条、翻三页正好 30 条、但 `total` 写着 900」
这种最典型的假绿，在补上 `pagination_total_reported` 之前一直是绿的。

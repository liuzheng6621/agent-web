# 账本域：借贷必须平衡

第三个域。前两个（咖啡店、动物救助）的正确性都长在「状态机」上，
账本域的正确性长在**不变量**上：每一笔交易借贷相等、总额恒为零、试算平衡。

这个域不是真实项目——是我们故意造的两个**独立实现**，用来回答一个问题：
同一份案例，换一个内部表示完全不同的实现，判得还一样吗？

| | 实现 A（`adapter-a.mjs`） | 实现 B（`adapter-b.mjs`） |
| --- | --- | --- |
| 金额表示 | 整数分（cents） | 两位小数字符串 |
| 分录存放 | 随交易存，余额每次现算 | 挂在账户上，余额增量维护 |
| 试算平衡 | 每次扫描全部交易 | 每个账户单独累加 |

两者对外只暴露同一个规范视图（`accounts` / `transactions` / `trial`），
`agent-web compare` 会验证同一批案例在两边的判决与视图契约是否一致。

## 跑

```bash
# 单实现
node bin/agent-web.mjs verify cases/ledger --adapter=ledger-a
node bin/agent-web.mjs verify cases/ledger --adapter=ledger-b

# 跨实现对照：判决一致率 + 视图契约
node bin/agent-web.mjs compare cases/ledger --adapters=ledger-a,ledger-b

# 判据准入：三个账本变异体（符号写反 / 合计说谎 / 假装入账）
node bin/agent-web.mjs certify cases/ledger --adapter=ledger-a
```

实测：4 条案例两边都是 `pass`，跨实现判决一致率 100%，视图契约三集合逐字相同；
certify 适用 5 个变异体抓到 4 个（剩下 `m-foreign-write-allowed` 在这套案例上造不出差异）。

## 四条案例各守什么

| 案例 | 守的规则 |
| --- | --- |
| `post-balanced` | 平衡记账成功；`total == 0`；两个账户余额一正一负 |
| `reject-unbalanced` | 借贷差 10 分必须拒，交易一条不能多 |
| `reject-negative` | 负数金额必须拒（方向已由 debit/credit 表达） |
| `reject-unknown-account` | 往不存在的账户记账必须拒 |

## 这个域逼出来的一条词汇缺口

`unchanged` 断言的语义是**整段轨迹**的初态对终态。写 `reject-unbalanced` 时，
第一版把 `trial` 也放进了 `unchanged`——结果失败：`trial` 是账户的派生视图，
开账户（前两步）本来就该让它变。

也就是说：**「从被拒的那一步之后不许变」这种口径，现在的断言词汇表达不了**。
目前只能用「被拒步之前先快照、被拒步之后只查关键集合」绕开。
这是一个真实的缺口，不是修辞——等哪天要写"试了三次不成功的操作绝不能留下半条记录"，
就必须有按步切片的不变式。先记在这里。

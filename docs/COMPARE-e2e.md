# 对上 tester-army/e2e：两套判决词汇的对照

`tester-army/e2e` 是一套 agentic 端到端测试框架（Apache-2.0，`packages/e2e` 0.23.0，pnpm monorepo）。
它和我们撞在同一个问题上：**一次 Agent 跑出来的东西，怎么判它到底证明了什么。**
这篇文档记录两边的对应关系、我们刻意不接的东西、以及 `ingest` 命令能做什么不能做什么。

## 一、为什么不把它当依赖

不是风格问题，是三条硬冲突：

1. **它的断言由模型判真伪。** README 里的例子是
   `await agent.assert('the invoice preview shows a prorated amount')`。
   我们的第一条宪法是「断言必须机器可判，禁 LLM judge」——一个由模型说「看起来对」的断言，
   在我们要回答的问题（这个实现和那个实现判决一致吗）里是不可用的。
2. **它依赖 Playwright + Chromium。** `@e2e-dev/web` 走 Chromium/Firefox/WebKit，
   构建还要整条 pnpm monorepo（`pnpm run check` 串九项检查）。
   本仓库的全部卖点是零依赖、`npm test` 十几秒、离线可跑。
3. **`engines.node = "^22.22.3 || >=24.8.0"`**，装进来就要求每一位读者先升 Node。

所以：**不装，反过来读它的报告。**

## 二、判决词汇对齐

| 它的说法 | 出处 | 我们叫什么 | 说明 |
|---|---|---|---|
| `passed` | `ResultStatus` | `pass` | 除非同时带 `expectedFailure`，见下一节 |
| `failed` | `ResultStatus` | `fail` | |
| `flaky` | `ResultStatus` | `unknown` | 重跑才过，说明这次没稳定证明任何事 |
| `timed-out` | `ResultStatus` | `unknown` | |
| `interrupted` | `ResultStatus` | `unknown` | |
| `skipped`（`cause: explicit`） | `ResultStatus` + `skip` | `unknown` | 有人声称验过，但没跑 |
| `skipped`（`cause: filtered`，`selected: false`） | 同上 | **`not_run`，不进分母** | 被过滤掉的测试不该算进任何一侧 |
| `blocked` | `StepVerdictStatus` / `RunStatus` | `unknown` | 原文：「`blocked` means the environment, credentials, or the executor's own budget prevented a product verdict — it says nothing about the product」 |
| `error`（`run.errors[]`） | `RunStatus` | `unknown` | 运行层事故，不是产品判决，但让一部分测试没结论 |
| 表外状态 | — | `unknown` + 退 2 | 认不出就说认不出，绝不默认成 pass |

**值得单独说一句**：`StepVerdictStatus = 'passed' | 'failed' | 'blocked'` 是他们在
`packages/e2e/src/agent/executor.ts:509` 独立演化出来的——**三值判决不是我们发明的，是两边各自撞到的**。
差别在于落在哪一层：他们的 `blocked` 只出现在 step 与 run 两层，
`ResultStatus`（六档）里没有「不知道」这一档；我们的 `unknown` 是**逐条测试**的判决状态，留在分母里。

## 三、他们有的，我们没有

- `flaky`：区分「稳定失败」与「重跑才过」。我们目前把两者都归 `unknown`，没有 `repeat` 概念。
- `serialGroupId` / `serialGroups`：明确哪些测试必须串行。
- `expectedFailure`：声明「这条本来就会失败」。我们没有等价物，见第四节陷阱。
- `limits` / `usage` / `changes` / `carried`：预算、用量、变更影响面、跨 run 继承。
- `ACTION_MAY_HAVE_COMMITTED` 那一档（v0.61.0 已补，见 8.1）。留在这里是因为它当初确实在这个清单里——
  补上的东西要从「缺什么」里划掉，否则这张表会慢慢变成愿望清单。

## 四、两个必须记住的陷阱

**陷阱一：`passed` 可能是「缺陷还在」。**
`results[0]` 可以是 `status: 'passed'` 但带
`expectedFailure: { reason: 'known gap: the cart badge does not update' }`，内部还有一条
`agent.assert` 步骤是 `failed`。它的语义是「这条已知会失败，而它确实失败了，所以标绿」。
**读成「产品正常」就全错了。** `ingest` 把它记成 `pass` + `reason_code: 'expected_failure_still_present'`，
单独数一笔 `counts.expected_failure_confirmed`，并在文本报告里报警。

**陷阱二：`skipped` 有两种。**
`cause: 'filtered'`（配 `selected: false`）是没被选中跑，`cause: 'explicit'` 是有人主动跳过。
前者不进分母，后者进（记 `unknown`）。混在一起算，可判定率会被人为做低或做高。

## 五、我们有的，他们没有

- **`killable` 欠账**：变异体在某个案例上留下了可观测差异、却没有任何断言抓住它。
  这是「你知道自己没验，而且知道差哪一条」的状态，不是 pass 也不是 fail。
- **`undetermined`**：连差异都造不出来，只能给等价性证据。
- **`blind` 断言格**：断言自己返回 unknown 的格数，单独计数。
- **`applies_to` 分母打折**：变异体声明自己只对某些能力/集合有意义，不适用的不进分母。
- **可判定率与机器判定占比**：一份报告里有多少判决真的能跨实现，这个数他们不报。

## 六、`ingest` 只做一件事

```
agent-web ingest <报告.json> [--from=e2e] [--json]
```

读它的 `report.json`（`packages/e2e/src/report/json.ts` 只有一个出口：
`onRunFinished(run) { writeTerminal('stdout', JSON.stringify(run.report, null, 2)) }`），
把每条 result 翻成 `pass / fail / unknown / not_run`，然后数三个数：

1. **可判定率** = (pass + fail) / 分母。分母含 `unknown` 与运行层事故。**flaky 不算过。**
2. **机器判定占比** = 机器断言行判出的判决 / (pass + fail)。只有这几条判决跨得了实现。
3. **一条断言都没有的判决数**。它们在我们的口径里是 `blind`：通过什么也没证明。

实测（拿它仓库里的官方 fixture `packages/e2e/schema/fixtures/report-v1.valid.json`）：
4 条结果 → `pass 1 / fail 1 / unknown 2`，可判定率 66.7%，机器判定占比 **0.0%**。
那个 0 不是我们算错：那 4 条里唯一一条断言是 `agent.assert`，由模型判定。

## 七、明确做不到的事

**不能拿我们的变异体去打他们的套件。** 那需要 Playwright 起浏览器、需要模型跑 `agent.act`，
离线环境两样都没有。任何声称「我们测了他们的套件」的说法，只有在真跑起来的机器上才成立。
这一条写在这里，是为了防止以后有人顺手把 `ingest` 的产物说成那个东西。

同理，`ingest` 的产物**不进** `report --counts`：那份报告只吃本仓库自己的判决。
外部报告的 `pass` 不是本仓库的 `pass`，混在一起数就是在给自己记虚功。

## 八、他们文档里那段「所有权边界」，指出了我们的一个洞

`writing-an-engine.mdx` 里有一张所有权表，把「谁负责什么」切得很干净：

| Owner | Concerns |
|---|---|
| **runner** | 收集、目标、重试、钩子、会话；查询与断言轮询、严格单匹配、步记录、超时；agent 规划、prompt、预算、账本；工具授权、secret 解析、纵深脱敏 |
| **engine** | 一次立即查询、一次节点读；一个节点的可操作性与输入派发；进程、页面、设备机制；安全观测的源遮蔽 |

这张表对我们的价值不在「照抄」，而在它把一件事显式化了：**引擎不许重试、不许因多匹配报错，那是 runner 的事**。
我们的适配器契约里没有这条——`observe` 能不能重试、`execute` 撞到多匹配该报什么，从来没写。

而真正扎到我的是另一条推论。他们把所有「状态分类」都收在 runner，engine 只能抛错或返回值。
我们也是这么分的，但**漏了一个分支**：`execute` 的返回值我们声明了封闭枚举
（`applied` / `rejected` / `unsupported` / `infra_error`，v0.61.0 起加 `may_have_committed`），
却从来没有检查它真的落在里面。

于是有了一个只在纸面上存在的契约：适配器回 `'success'`，四个分类分支全不命中，
这一步既不失败也不 `unknown`，一路滑到终态断言——终态恰好成立，判决就 `pass`。
一个拼错的 `'applied '`（尾空格）、一个大写 `'APPLIED'`、一个读起来很合理的 `'ok'`，全都能过。

这不是适配器撒谎，也不是断言写错。它坏在**枚举**上：契约说四选一，实现回了第五个，
而「没写 else」这件事本身不会报错。v0.60.0 补了两处，互相独立：

- `src/runner.mjs` 判 `unknown / contract_violation`（不是 `rejected`——这一步做成了没有，无法判断）；
- `probe` 第 6 项 `outcome-contract`，适配器接进来的第一分钟就报警，即使有人把白名单改回去也拦得住。

现场证据是 `docs/museum/e07-contract-violation.mjs`：同一份适配器，旧路径判 `pass`，现在判 `unknown`。

**这条对照的意义**：e2e 用异常（`EngineError` + 一组固定错误码）而不是返回值，所以他们天然没有这个洞——
抛不出已知错误码的就是「未知错误 → 基础设施故障」。返回值风格的契约更易读，但必须自己补上
「值不在枚举里」这一支。这是两种风格的真实代价，不是风格偏好。

### 8.1 顺着这张表，还挖出第二件事：`may_have_committed`

他们的错误码里有一个 `ACTION_MAY_HAVE_COMMITTED`，明确写着「runner 不再重复执行」。
我们当时只有四档，写请求超时、连接断在响应头之前、后端 5xx 全被塞进 `infra_error`。

判决上没问题——都判 `unknown`。**问题在重放**：`infra_error` 的语义是「这次调用没发生」，
可以重试；`may_have_committed` 的语义是「可能已经生效」，不许重试。
两条相反的指令共用一个码，重放器只能猜，猜错就是把已经扣了的钱再扣一次。

v0.61.0 加了第五档，判决 `unknown / effect_uncertain`，与 `infrastructure_error` 分开报。
这是六个未决问题里**唯一一条会改变判决结果**的，其余五条是结构整理。
决策全文在 `E:/SKIl.1/ai研究/BACKLOT_DECISIONS.md`。

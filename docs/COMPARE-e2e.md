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

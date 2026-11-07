# 失败案例库

这个目录收藏的**不是功能演示，是假判决**——假绿（错的被放过）与假红（对的被定罪）都收。

每件展品记录一种「判决看起来很笃定、实际什么也没证明」的情形。它们不是假想的：十二件里有十一件来自这个仓库自己踩过的坑，另一件（01）是真实事故的完整复现。

## 为什么单独给它一个目录

三值逻辑（`pass` / `fail` / `unknown`）只解决一件事：**不知道的事不许算成通过**。
它解决不了另一件事：**测量对象被悄悄换掉了**。

后者才是最难发现的。断言写错了会红，环境挂了会变 `unknown`，只有「你以为在测 A，其实一直在测 B」会稳定地绿下去。这类问题的共同结构是：每一步都合法，每一次观测都真实，判决也因此完全正确——只是它不是关于你以为的那件事。

所以这个仓库的可信度不建立在新功能上，建立在**能把自己也被骗过的记录摊开**上。

## 收展标准

一件展品必须同时满足四条，缺一条不收：

1. **有症状**：说清楚假绿长什么样，最好一句话能讲明白
2. **有机制**：指出是哪个机制抓住了它，而且要能指到代码或判决顺序表的具体条目
3. **可复现**：`run()` 能跑出「无机制时怎么样、有机制时怎么样」两个判决
4. **被判过**：`test/museum.test.mjs` 会验证它确实被抓。展品自己不被验证，这个目录明天就变成墓地

第 4 条是硬的。展品是一个**可执行的论断**，不是一篇散文。

## 馆藏

| # | 展品 | 无机制时 | 有机制时 | 谁抓住的 |
| --- | --- | --- | --- | --- |
| 01 | 身份塌缩 | `pass` | `fail` / `unexpected_rejection` | `compare` 跨实现对照 |
| 02 | 事件词表缺失 | `pass` | `unknown` / `unsupported_event` | `manifest.events_types` |
| 03 | 草稿闸门 | `pass` | `unknown` / `unconfirmed_draft` | 判决顺序第 2 条 |
| 04 | 前置条件为假 | `fail` | `unknown` / `invalid_initial_state` | 判决顺序第 6 条 |
| 05 | 卡住的适配器 | 挂死，无判决 | `unknown` / `infrastructure_error` | `judge` 外层超时 |
| 06 | 角色单射被破坏 | `pass` | `unknown` / `invalid_environment` | 复位后 `roleBindings` 检查 |
| 07 | 契约外的 outcome | `pass` | `unknown` / `contract_violation` | `OUTCOMES` 白名单 + `probe` 第 6 项 |
| 08 | 同一个洞的第二个地方 | `pass` | `unknown` / `contract_violation` | 分类语义抽成一份 · 结构守卫扫源码 |
| 09 | 文档里的退出码 | `pass` | `fail` / `doc_code_mismatch` | 第 8 章的表与代码对账（`test/exit-codes.test.mjs`） |
| 10 | 环境没起来却报了抓获率 | `pass` | `fail` / `unusable_run_reported_as_zero` | `certify` 的 `allUnusable` 判据 + 退出码 2 |
| 11 | 没人读的幽灵字段 | `pass` | `unknown` / `invalid_environment` | `environment` 封闭键集 + `manifest.clock_policies` 对账 |
| 12 | 同一笔账，两把尺子 | `false`（假红） | `true` | `close()` 一把尺（相对 1e-9）+ `test/relation.test.mjs` |

## 01 · 身份塌缩

**症状** 适配器按「走店员线还是顾客线」选令牌，忽略了案例里写的 `as`。案例说「让另一位顾客去取」，实际执行的是下单人本人。

**三值为什么抓不到** 一切观测正常，目标断言（订单变成 `PICKED`）也是真的。没有一步是「不知道」——被执行的人被换掉了，而换掉之后这件事完全成立。

**谁抓住的** 跨实现对照。同一份案例在诚实实现上判 `fail`，在塌缩实现上判 `pass`。判决不一致本身就是证据：至少有一边的测量对象不对。三值逻辑永远发现不了这件事，因为它不是关于真假的问题。

**复现** `node -e "import('./docs/museum/e01-identity-collapse.mjs').then(async m=>console.log(await m.run()))"`

## 02 · 事件词表缺失

**症状** 一条「全程不该出现退款事件」的断言，在后端压根不记录退款事件时永远成立。「没查到你退款」被读成「你没有退款」。

**三值为什么抓不到** 这条断言返回的是货真价实的 `TRUE`。要抓它，必须在断言之外另立一份「这个实现到底记录哪些事件类型」的声明，而三值只管真假不管覆盖面。

**谁抓住的** `manifest.events_types`。断言里出现词表外的类型判 `unknown`，绝不返回 `TRUE`。

## 03 · 草稿闸门

**症状** 从请求日志自动生成的案例，未经任何人看过，直接判 `pass`。生成器与判决器是同一个模型的产物，等于让出题的人自己批卷。

**三值为什么抓不到** 这类案例的断言通常是「照着我刚才成功的那次写」，所以它当然成立。全绿得很自然。

**谁抓住的** 判决顺序第 2 条。带 `draft` 字段且未 `confirmed` 的案例判 `unknown`：它还不是一张考卷，没有资格得分。

## 04 · 前置条件为假

**症状** 初态没准备好（种子没落、上一个用例没清干净），本来该说「这局不算」，却被记成 `fail`，然后进了失败率统计。

**三值为什么抓不到** 前置条件求得出真假，它明确为假。只是「假」不等于「被测系统做错了」。

**谁抓住的** 判决顺序第 6 条，与第 16 条刻意不对称：环境不干净不是被测对象的过错。把噪声算进失败率，失败率就再也不能用来判断「这次改动坏了什么」。

## 05 · 卡住的适配器

**症状** 某个接口不返回（长事务、死锁、连接池耗尽），整批案例停在一条上，跑到天亮没结果，最后被人 Ctrl-C——已经跑完的那 40 条判决也一起没了。

**三值为什么抓不到** 这不是断言的问题，是根本没走到断言。没有硬上限的判决器把「等待」当成一种状态，而等待没有判决。

**谁抓住的** `judge` 的外层超时。单条超上限判 `unknown`，批次继续。

## 06 · 角色单射被破坏

**症状** 适配器复位后声称绑了 `customer` 和 `customer2`，实际两个角色是同一个账号。于是「另一个人能不能取走这杯」这条案例，永远测的是「本人能不能取走」。

**三值为什么抓不到** 同上，一切观测正常，只是缺少一个可以对照的第二人。

**谁抓住的** 复位之后的 `roleBindings` 单射检查。两个角色指向同一身份判 `unknown`：环境配错了，这一局不算。

## 怎么跑全部展品

```bash
node --test test/museum.test.mjs
```

它会逐件运行，并断言：有机制时判的不是 `pass`、理由码与上表一致、声称「无机制时会 pass」的那些确实能复现出 `pass`。

## 哪些展品能变成自动探测

展品证明「这个坑存在」，但能不能在**每一条判决**上自动查出来，是另一件事。目前三条变成了 `agent-web traps` 的探测器（另有两条靠 `probe`，其余靠显式判决码）：

| 展品 | 探测器 id | 能不能自动查 |
|---|---|---|
| e01 身份塌缩 | `identity-collapse` | 能，前提是适配器上报每步的实际执行身份 |
| e02 事件词表缺失 | `event-vocabulary` | 能，靠判决里留的环境指纹 |
| e03 草稿闸门 | `draft-gate` | 能，只看案例的 `draft.status` |
| e04 前置条件为假 | — | 不能：它是判定规则（判 `unknown`），不是结构性风险 |
| e05 卡住的适配器 | — | 不能：它让判决作废，靠 `reason_code: infrastructure_error` 识别并另行统计 |
| e06 角色单射被破坏 | — | 不能：同上，`invalid_environment` 已经是显式判决 |
| e07 契约外的 outcome | `probe/outcome-contract` | 能，`probe` 第 6 项每次抽查都验 |
| e08 同一个洞的第二个地方 | `probe/outcome-contract` + 源码结构守卫 | 能，两层：`probe` 第 6 项验行为，`test/step-outcome.test.mjs` 验「分类语义只有一份实现」 |
| e12 同一笔账，两把尺子 | — | 不能：它是求值器判据（`close()`），不是结构性风险；`test/relation.test.mjs` 用「大额合法账 + 差 100 元真不平」双向盯着 |

另外 `traps` 里有一条 `terminal-only`（只看终态），它的展品还没写——这是一个已知空缺，留着就是因为不想让「有探测器没展品」变成常态。规则写进了 SPEC 第 12 章：**没有展品的陷阱不收。**

## 12 · 同一笔账，两把尺子

**症状** `relation` 的五个算子里，`sum_equals` 用绝对容差 `1e-9` 判「和等于总额」，`sum_by_equals` 用精确相等判「借贷平衡」。一笔 `debit: 0.1 + 0.2 / credit: 0.3` 的账：`sum_equals` 说平，`sum_by_equals` 说 `relation_violated`。同一个判决器、同一份状态，两个算子给出相反的判决——总有一个在撒谎。

**这是馆藏里第一件假红。** 前面十一件全是「错的被放过」；这一件是「对的被定罪」。假红比假绿更隐蔽：假绿会让坏东西溜过去，但至少不会有人去查；假红让人去查一笔没坏的账，查三次之后，**没人再信这个断言**——而断言一旦没人信，它抓到的真 violation 也没人信了。

**两把尺子为什么能共存四十多个版本** 现有案例里没有一笔浮点账。`0.1+0.2` 这种误差只有写小数金额的案例才踩得到，而全仓的账本案例用的都是整数。也就是说：两把尺子在所有现有输入下结论恰好相同——和 e08（两份实现结论恰好相同）是同一个结构。**行为测试只能证明「现在一致」，证明不了「不是碰巧一致」。**

**机制** `src/assert/relation.mjs` 只留一把尺：`close(x, y)`，容差随量级走（相对 1e-9，绝对下限 1e-9），三个数值算子（`sum_equals` / `product_equals` / `sum_by_equals`）共用。选相对容差的依据是 float64 本身：它在 1e9 量级的最小间隔约 1.2e-7，比固定 1e-9 大两个数量级——绝对容差在这个量级必然假红，容差就必须随量级走。

展品带**反向验证**：`close` 若被改成「永远相等」，0.1+0.2 那幕会过，但「差 100 元的真不平必须照旧 false」那一幕会把它拦下来。一把尺的意思不是「宽」，是「同一份误差预算量所有账」。

**复现** `node -e "import('./docs/museum/e12-two-rulers.mjs').then(async m=>console.log(await m.run()))"`

## 投稿

发现新的假通过，开个 issue 附上：症状一句话、最小复现、你觉得哪个机制应该抓住它。收进来的展品会进这张表，并写进 CHANGELOG。

## 07 · 契约外的 outcome

**症状** 把 `execute` 的返回值从 `applied` 改成 `'success'`——一个在任何文档里都不存在、但读起来完全合理的词——整条案例仍然 `pass`，理由码 `ok`。

**三值为什么抓不到** 终态断言问的是「最后有没有这张订单」，那件事确实发生了。判决在它的口径内是对的，只是它回答的不是「这一步做成了没有」。

**谁抓住的** v0.60.0 加的两处，互相独立：`src/runner.mjs` 的 `OUTCOMES` 白名单（判 `unknown / contract_violation`）与 `probe` 的第 6 项 `outcome-contract`。前者拦住判决，后者在适配器接入的第一分钟就报警——**即使有人把白名单改回去，探针也会独立报出来**。

**为什么值得单独一件** 这是唯一一件「适配器没有撒谎、断言没有写错、环境没有坏」的假通过。它坏在**枚举**上：契约说四选一，实现回了第五个。任何靠 `if` 串联的分类器都有这个洞——不是没写 `else`，是**没写 `else` 这件事本身不会报错**。

**复现** `node -e "import('./docs/museum/e07-contract-violation.mjs').then(async m=>console.log(await m.run()))"`

## 08 · 同一个洞的第二个地方

**症状** `draft` 的录制回放路径上，适配器返回契约外的 `outcome`，这一步照样被承认，`replayTrajectory` 返回 `ok: true`。于是「录下来这段还能跑」这个结论，是在没验证那一步的前提下给出的。

**为什么它是独立的一件** 07 修的是 `src/runner.mjs` 的 step-4 分支链，修得干净，测试也补了。而 `src/draft.mjs` 里那段 if 是它的**手抄副本**，一字不差地带着同一个洞活了一个版本。修的时候只修了看见的那一处——这不是手滑，是复制粘贴式复用必然会付的账。

**谁抓住的** 把分类语义抽成 `src/step-outcome.mjs`，两处都调它；外加 `test/step-outcome.test.mjs` 里那条**结构守卫**：它扫两个文件的源码，只允许剩下 `res.outcome === 'applied'` 这一条手写分支，多一条就红。

**这条守卫为什么要看源码而不是看行为** 两份实现行为一致的时候，恰恰是最难发现它们会一起烂掉的时候。行为测试只能证明「现在两边一样」，证明不了「以后不会分叉」。

**复现** `node -e "import('./docs/museum/e08-second-place.mjs').then(async m=>console.log(await m.run()))"`

## 09 · 文档里的退出码

**症状**：`docs/SPEC.md` 第 8 章写「3 = 用法错误、路径不存在、适配器名未知」。实际跑一遍，未知适配器名退出 `2`，`--help` 印的也是 `2`。

**这不是笔误，是四十多个版本没人对过账。** 代码里 62 处 `return 2`、一处 `return 3` 都没有。而测试全绿——因为退出码只在各命令自己的测试里按需断言：

```js
assert.equal(r.exitCode, 2);   // test/ingest.test.mjs
```

每条测试都对着自己那一小段，都对。但「第 8 章那张表 = 代码真的返回的码」这件事，从来没有一条测试在管。

**为什么它算假通过**：这份仓库的宪法是「断言必须机器可判」。文档也是断言——它断言了程序的行为。一张行为表靠人眼对账，就等于允许一条永远不会被求值的断言存在。它比代码里的 bug 更糟：代码错了测试会红，文档错了什么都不发生。

**机制**：`test/exit-codes.test.mjs` 把表和代码对上，双向查——

- 代码返回了表上没有的码 → 红（新增退出码变成规范变更）
- 表里列了代码从不返回的码 → 红（文档在描述一个不存在的约定）

`checkDocAgainstCode()` 是纯函数，所以展品能直接喂它**修之前那张旧表**，证明它真的抓得住。喂当前表必须绿——这是反向验证，机制不是见谁都咬。

**这条也顺手把「文档漂移」变成了可检的类别。** 在此之前，`docs/` 里所有数字（断言数、命令数、变异体数、测试数）都靠 `scripts/status-line.mjs` 一个脚本管；退出码这张表恰好不在它的射程内，于是漏了四十个版本。漏的原因不是没人写检查，是**没人列出「哪些文档内容属于断言」**。

## 10 · 环境没起来却报了抓获率

补 `applies_to` 的时候顺手撞出来的，比 `applies_to` 本身严重得多。

先是 animal 域的 `certify` 直接崩：`Cannot read properties of undefined (reading 'adoption_applications')`。查下去是两件事叠在一起——8181 后端没起，每条案例的 `base.ctx.initial` 与 `base.ctx.final` 都是 `undefined`；而 state 层变异体走「免重放」快路径，拿 `undefined` 去 `tamper(state)`，变异体第一行读 `state.adoption_applications` 就 `TypeError`。

报错文本把人往错方向带：它说 `Cannot read properties of undefined`，读者会以为变异体写错了。实际是环境没起来。

**修掉崩溃之后露出了真正的问题。** 它不崩了，改成报 `变异体抓获率 0/5 = 0.0%`。那个 `0.0%` 在读者眼里是「这些断言一条都抓不住变异体」，实际含义是「一条案例都没跑起来」——两件事的方向完全相反。而且它退 0（`survived === 0` 时不触发 `return 1`），等于告诉 CI「查过了，没问题」。

**为什么它算假通过**：这里被换掉的测量对象是「被测的东西」。`certify` 问的是「断言够不够狠」，可它实际测的是「这台机器上有没有后端在跑」。回答这个问题不需要任何断言，所以任何断言都会显得一样没用——`0.0%` 就是这么来的。它不是成绩，也不是缺陷，是**问题没被问出来**。

**机制**：两层。

第一层是别崩。`certifyCase` 里加 `ctxUsable`：`base.ctx.initial` 与 `base.ctx.final` 只要有一个是 `undefined`，就不走快路径，退回重放。`transformCtxProbe` 自己也加了一道 `if (ctx.initial !== undefined)`——别人直接调它时同样不该把「环境没起来」变成「变异体写错了」。

第二层是别把「没测」报成「没抓住」。`src/traps.mjs` 的 `UNUSABLE_CODES`（`infrastructure_error` / `contract_violation` / `effect_uncertain`）现在被 `certify` 也用上了：一条案例的 `base.verdict.reason_code` 落在这组码里，就记进 `summary.unusableCases`；全部落进去则 `allUnusable = true`，此时——

- `caughtRate` 是 `null`，不是 `0`
- `formatCertify` 先印「这一跑不成立」，**并且不印抓获率那一行**
- `certifyExit` 退 **2**（用法或环境错误），不是 0

**为什么这组码不能只写 `infrastructure_error`。** v0.60.0 加了 `contract_violation`，v0.61.0 加了 `effect_uncertain`，它们同样表示「这一次执行本身不可信」。判据必须写成**集合**，而且反例不能错杀：`missing_observation` 是**真盲区**（跑起来了、断言看不出来），它必须留在分母里。这条判据在 `src/traps.mjs` 与 `certify` 之间只有一份实现，`test/outcome-contract.test.mjs` 有反例测试盯着。

**它顺带说明了一件事**：`0.0%` 和 `null` 在报表里长得差不多（都让人不想看），但前者会让人去补断言，后者会让人去起服务。工具在分不清的时候，宁可少说一句，也不能说反。

## 11 · 没人读的幽灵字段

`clock_policy` 从 v0.30.0 起就被 `src/runner.mjs` 读出来传给 `adapter.reset({ clockPolicy })`。
四十多个版本过去，全仓 46 条案例没有一条声明过它，`docs/SPEC.md` 第 2 章没写这个键，
`validateCase` 完全不校验 `environment`，11 个适配器里没有一个读过 `clockPolicy`。

它从出生那天起就是空的。而这条路上**没有任何地方会报错**：写错的键、拼错的键、
早就废弃的键，全都是「合法 JSON，安静地躺在那儿」。崩溃会有人修，安静没人管。

同一个 `environment` 里还挂着两个同样的幽灵键，就在 `cases/coffee/two-items.json`：

```json
"environment": {
  "adapter": "memory",
  "reset_strategy": "identity",
  "scopes": ["orders", "menu", "status_log"]
}
```

这条案例的判决一直是 `pass`。它没错，只是后两行从来不代表任何东西。

更麻烦的是 `clock_policy` 不是纯装饰：一个适配器可以「看起来支持 frozen」——
它把时间戳写进视图，取的是 `Date.now()`。案例声明 frozen，判决照样 `pass`，
因为没有任何断言在比时间戳。等到某天有人加了一条 `timeliness`，它会随机红，
而且只在慢机器上红。

判据有三条：`environment` 是**封闭**键集（`adapter` / `seed` / `clock_policy`），多一个键就是
`invalid_case`；适配器用 `manifest.clock_policies` 声明真支持哪几种；两边对不上在**开跑之前**
判 `unknown / invalid_environment`。`probe` 第 12 项再查一遍「声明 frozen 的适配器两次同 seed
复位指纹相同」——这一项只做单向判定，措辞里写明局限：相同**不证明**时间被冻结。

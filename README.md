# agent-web

**给 Agent 写机器可判的集成测试。一份案例，多个实现，判决必须一致。**

> Machine-judgeable integration tests for agents. One case, many implementations, verdicts must agree.

**中文** · [English](README.en.md)

Agent 干活的质量问题，最后都会落到一句话上：谁来判它做对了没有。

现在的主流答案是再请一个模型来看看——也就是 LLM judge。这不是测试，这是征求意见。两个模型互相打分，分数很整齐，回归时该炸的照样不炸。

agent-web 的立场很简单：**能写成断言的，绝不交给模型判断。**

---

## 它到底做什么

你有一个真实业务系统（订单、工单、库存、审批，随便）。你想让 Agent 在上面干活，然后想知道它干得对不对。

agent-web 要求你先做一件事：**把"干对了"写成断言**。

```json
{
  "kind": "field_equals",
  "selector": { "collection": "orders", "index": 0 },
  "path": "status",
  "value": "PICKED"
}
```

然后它做三件事：

1. 复位环境（reset），跑一条 Agent 轨迹（或者人写的参考轨迹）
2. 观测终态，按断言求值
3. 给出判决：`pass` / `fail` / `unknown`，附首条失败原因和证据

判决是纯函数算出来的。没有模型参与，没有分数，没有"大约做对了"。

---

## 三值判决，为什么必须有 unknown

这是整个设计里最不肯让步的一点。

二值判决会逼着你把"我看不出来"记成"失败"或"通过"，两种都在骗自己。所以第三个值必须存在：

| 判决 | 含义 |
| --- | --- |
| `pass` | 所有目标断言与不变量成立 |
| `fail` | 至少一条断言为假，附首条失败与证据 |
| `unknown` | 这条案例在当前环境里没有可观测判据 |

`unknown` 不是失败。它意味着**信息不足**，常见来源：能力不在 manifest 里、某个观测域缺失、初始状态不干净、适配器自己挂了。

关键在于它**不从分母里消失**——它被单独计数：

```
可判定率 = (pass + fail) / N
未知占比 = unknown / N
```

一条把 `unknown` 偷偷记成 `pass` 的测试框架，会给你 100% 的绿色，然后在生产里翻车。可判定率是这套东西唯一诚实的自评指标。

---

## 快速开始

零依赖，只要 Node ≥ 20。

```bash
git clone https://gitee.com/liu-everything_impossble/agent-web.git
cd agent-web

# 1. 跑内置的内存业务系统（确定性，不需要任何外部服务）
node bin/agent-web.mjs selftest

# 2. 同一份案例，跑真实后端（Spring Boot 咖啡店，见 examples/）
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080 \
  node bin/agent-web.mjs verify cases/taixianglian --adapter=taixianglian

# 3. 判一个 Agent 的实际动作序列（而不是案例自带的参考轨迹）
node bin/agent-web.mjs verify cases/memory-demo --adapter=memory   --trajectory=examples/candidate-trajectories

# 4. 把同一份案例同时喂给两个实现，比较判决
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080 \
  node bin/agent-web.mjs compare cases/memory-demo --adapters=memory,taixianglian
```

第 4 条是整个项目的心脏。输出长这样：

```
案例                           memory        taixianglian  判决一致
-----------------------------------------------------------------
memory/cancel-before-pickup  pass          pass          ✓
memory/foreign-pickup        fail          fail          ✓
memory/goal-not-reached      fail          fail          ✓
memory/happy-path            pass          pass          ✓
memory/readonly-menu         pass          pass          ✓
memory/skip-ready-stage      fail          fail          ✓
memory/unknown-capability    unknown       unknown       ✓

跨适配器判决一致率 100.0% (7/7)

视图契约
  memory 与 taixianglian：兼容（3 个集合逐字相同）
```

左边是几十行内存代码写的假系统，右边是真实的 Spring Boot + H2 后端。同一份案例，七个判决全对上。

**对不上就是信号。** 要么案例偷偷假设了某个实现的细节，要么两边真的不一样。下面第二条就是这么抓出来的。

---

## 接你自己的应用

上面三条命令跑的是仓库自带的两个实现。要让 agent-web 考**你自己的系统**，写一个 `.mjs` 指过去就行，不用改本仓库任何一行：

```bash
node bin/agent-web.mjs verify my-cases --adapter=./my-adapter.mjs
```

适配器只有五个方法：

```js
{ manifest(), reset({ seed }), observe(runId), execute(runId, action), close(runId) }
```

`examples/adapter-template/` 是一个**能直接跑**的骨架，业务是仓库出库单（故意和咖啡店无关）：

```bash
node bin/agent-web.mjs verify examples/adapter-template/cases \
  --adapter=./examples/adapter-template/warehouse-adapter.mjs
```

```
pass    warehouse/foreign-submit         ok
pass    warehouse/happy-path             ok
fail    warehouse/skip-approve           unexpected_rejection
unknown warehouse/unknown-capability     coverage_gap
```

四行覆盖四种判决形态：正常通过、负例被正确挡下、负例漏挡、能力缺口。骨架里 `createBackend()` 就是"你的系统"，换成 `fetch` 即可，其余不动。

接入指南（含三条最容易踩的坑）见 [examples/adapter-template/README.md](examples/adapter-template/README.md)。

---

## 两个实跑出来的数字

**判决一致率 100%（7/7）**：`cases/memory-demo` 与 `cases/taixianglian` 除 `environment.adapter` 外字节完全相同，分别打到内存适配器和真实 HTTP 后端，判决向量完全一致。

**可判定率 85.7%（6/7）**：七条里有一条故意问了一个系统根本不具备的能力（退款），它正确地落进 `unknown`。这 14.3% 的未知不是缺陷，是这套东西该有的样子——它承认自己看不见。

耗时 p50 ≈ 1s，p95 ≈ 1.1s（真实后端，含 reset 时建三个账号）。

---

## 它抓到过一次假通过

第一次把七条案例打到真实后端，`foreign-pickup` 判了 `pass`。

这条案例说的是：顾客 A 下单，店员接单出餐，然后**顾客 B 去取**。在内存适配器上它正确地判 `fail`（`not_owner`）。到了真实后端，它过了。

那意味着真实后端允许别人取走你的咖啡——一个标准越权。有趣的部分是根因。

后端 `OrderFlowService.loadVisible` 写得很干净：

```java
if (!user.isStaff() && !user.userId().equals(order.getUserId())) {
    throw new BusinessException(ErrorCodeEnum.ORDER_NOT_FOUND);
}
```

没有问题。有问题的是**我自己的适配器**：

```js
const token = route.who === 'staff' ? ctx.staff.token : ctx.customer.token;
```

它按"走店员线还是顾客线"选令牌，把 `customer` 和 `customer2` 塌缩成了同一个人。案例嘴上说"让 B 去取"，实际执行的还是 A。判决 `pass` 是真的，只是它测的不是案例声称的那件事。

**一个二值框架会就此收工**——绿色，通过，继续下一条。三值框架里也一样是绿。真正把它揪出来的是第 3 条命令：同一份案例换个实现，判决翻了。

这就是为什么"跨实现判决一致"必须是核心，而不是可选的对照实验。断言集可以写错，适配器可以撒谎，模型可以幻觉；**让两套独立实现在同一份案例上给同一个判决**，是这套东西唯一诚实的校验方式。

修完之后七条全对。FINDING 全文见 [docs/FINDING-001.md](docs/FINDING-001.md)。

---

## 判别人的轨迹，不只是判实现

案例自带的 `reference_trajectory` 只回答一件事：这条路能走通。真正评 Agent 时，判的是**它自己走的那条路**。

```bash
agent-web verify cases/memory-demo --adapter=memory --trajectory=examples/candidate-trajectories
```

`examples/candidate-trajectories/` 里放了两条演示轨迹，跑出来正好相反：

| 案例 | 参考轨迹 | 候选轨迹 | 说明 |
| --- | --- | --- | --- |
| `happy-path` | pass | **fail** | 候选只下单就交差，目标没达成 |
| `goal-not-reached` | fail | **pass** | 候选多走了 `kitchen.ready`，目标达成 |

第二行最值得看：同一个案例，参考轨迹判 fail，候选轨迹判 pass。断言测的是**目标是否达成**，不是**动作是否照抄**。轨迹文件与案例结构完全一致，共用一套校验。

候选轨迹模式下，输出里的 ✓/✗ 是相对 `expected.json`（它描述参考轨迹）的基线，落差本身就是结论。

---

## 从真实流量到轨迹：record

候选轨迹此前只能手写，这就把「能判 Agent」和「好用」隔开了。`record` 补上这一段：吃 Agent 自己发的请求日志，产出 `verify --trajectory` 能直接吃的文件。

```bash
node bin/agent-web.mjs record examples/agent-traces/happy-path.jsonl \
  --adapter=taixianglian --case=taixianglian/happy-path \
  --out=examples/agent-traces/recorded/happy-path.json
```

输入是一行一个请求的 JSONL（或一个数组），每条最少要有 `as`、`method`、`path`，能带上 `body`、`status`、`response`：

```json
{"as":"customer","method":"POST","path":"/waiter/order","body":{"dishList":[{"dishName":"拿铁","count":1}]},"status":200,"response":{"code":200,"data":{"id":2}}}
```

也接受已经归一化的动作（`capability` + `arguments` + `outcome`），运行时直接导出这种最省事。

还原出来的东西：

```
读入 8 条动作，还原出 4 步
  s1 order.create as=customer applied {"items":[{"dishName":"拿铁","qty":1}]}
  s2 kitchen.accept as=staff applied {"orderId":"$s1.orderId"}
  s3 kitchen.ready as=staff applied {"orderId":"$s1.orderId"}
  s4 order.pick as=customer applied {"orderId":"$s1.orderId"}

跳过 4 条：unmapped_request×3 read_skipped×1
```

三件事值得说清楚：

**绑定是自动推的。** 某一步的参数值等于前面某步返回的实体 id，就写成 `$s1.orderId`。不这么做，录下来的 `orderId: 2` 只在那一次环境里成立——重置一次数据库就全错。上面这份日志里真实 id 是 2，而 built-in 内存适配器的 id 从 1001 起，正是靠绑定才能把它原样重放。

**只录写操作。** 读操作是 Agent 用来摸 id 的，不是被判的动作，混进来还会撞 `allowed_capabilities`，把好轨迹判成 `invalid_action`。要录就加 `--include-reads`。

**认不出来就跳过，不猜。** 每条跳过都带原因（`unmapped_request` / `missing_as` / `no_outcome` / `unparsable_arguments`），写进产物的 `skipped` 字段。安静地塞一条假动作，比少一步危险得多。

实证：`examples/agent-traces/happy-path.jsonl` 是真跑出来的——一个不用 agent-web 任何代码的脚本打真实后端，8 个请求，落盘前把令牌与密码抹成 `<redacted>`。还原出的 4 步轨迹，在内存适配器（id 1001 起）和真实后端（id 2）上**都判 pass**。

---

## 从轨迹到案例：draft

`record` 解决了轨迹从哪来，剩下的问题是**案例从哪来**。此前只能人肉：盯着终态一条条手写 `field_equals`，写完还得担心 `id` 是不是钉死在那一次运行上。

`draft` 把这一步变成一次回放：

```bash
node bin/agent-web.mjs draft examples/agent-traces/recorded/happy-path.json \
  --adapter=memory --out=examples/agent-traces/drafts/happy-path.case.json
```

```
回放 4 步，终态如下（初态指纹 fnv1a32:f584a774）
  menu        3 -> 3      未变
  orders      0 -> 1      +1
  status_log  0 -> 4      +4

目标断言 3 条
  [0] {"kind":"count_delta","selector":{"collection":"orders"},"delta":1}
      └ orders 由 0 条变成 1 条（净变化 +1）
  [1] {"kind":"field_equals","selector":{"collection":"orders","index":0},"path":"status","value":"PICKED"}
      └ orders 的 status 停在 "PICKED"（这是本次运行的终点，不代表它应该停在这里）
  [2] {"kind":"status_transition","selector":{"collection":"orders","index":0},"path":"status","transitions":[["PENDING","MAKING"],["MAKING","READY"],["READY","PICKED"]]}
      └ orders#0 实际走了 PENDING -> MAKING -> READY -> PICKED

不变量 1 条
  [0] {"kind":"unchanged","scopes":["menu"]}

待确认 5 条
  - status_log 是事件流水（manifest.events_scope），本次新增 4 条，草稿不为它生成 count_delta……
  - 草稿的断言全部从「实际发生」反推，回放必然 pass —— 它描述现状，不表达应该。
  - 至少补一条负例：越权、非法状态迁移、重复提交应当被拒。
  - allowed_capabilities 目前照抄轨迹里用到的写操作……
  - 确认后删掉 draft 字段，这条案例才算接手。

草稿自检：pass（ok）—— 这只说明格式合法、可重放，不说明判据正确。
```

四件事值得说清楚。

**产物一定是绿的。** 断言就是从这次运行的终态抄下来的，回放当然 pass。这句话必须印在输出里，否则下一个人会把它当判据用。draft 交付的不是测试，是一份**待确认清单**：这个值对不对、这条该不该有、缺了哪条负例。

**环境相关的字段一条都不写。** `id`、`createTime`、`pickupNo`、`username` 换一次 reset 就变，写进断言等于把案例钉死在这一场运行上。绑定表达式（`$s1.orderId`）能处理这类值，断言不能——断言里没有 `$s1` 这种语法。

**证不出来的不写。** 事件流水的条数取决于实现记多细；多条新实体时挑哪一条当判据属于业务判断。这两类一律进 `todo` 并附上原因。少写一条比写错一条安全：错的断言会一直绿。

**负例步的能力也要进白名单。** runner 在调用适配器之前先查 `allowed_capabilities`，少写一条，`expected_outcome: rejected` 的步会在「系统拒绝它」之前就被判成 `invalid_action`——负例被自己的白名单挡在了门外。这个坑是写 draft 的时候自己踩出来的，测试里留了一条守着。

---

## 一眼看懂一条案例：flow

```bash
# 先跑一条案例，拿到判决证据
node bin/agent-web.mjs verify cases/memory-demo/happy-path.json \
  --adapter=memory --out=happy-path.jsonl

# 再生成自包含流程图
node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --result=happy-path.jsonl --out=happy-path.flow.html
```

也可以叠加候选轨迹（传轨迹文件，或一个按案例文件名匹配的目录）：

```bash
node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --trajectory=examples/candidate-trajectories \
  --result=happy-path.jsonl --out=happy-path.flow.html
```

生成的 HTML 是**单文件、零依赖**，双击即可打开。它把步骤、执行角色、预期/实际结果、动作参数、状态事件和断言结果放在同一张图里；可以筛出偏差或未执行步骤，点击步骤展开参数。动态内容会 HTML 转义，token / password / cookie / API key 等字段默认脱敏。

不带 `--result` 时画计划轨迹，不伪造实际执行结果；判决里若是 candidate trajectory，会优先画实际执行轨迹。流程图只读、不重跑适配器。

---

## 检测被测系统变了没有

```bash
agent-web verify cases/x --adapter=X --out=before.jsonl
# ……应用改了一版……
agent-web drift before.jsonl after.jsonl
```

比较两批判决里初态的**规范视图指纹**：一致 / 漂移 / 只在旧 / 只在新，有漂移退出码 1。漂移不是判决错，而是「这份案例还描不描述当初那个应用」——菜单多一项、字段改个形状，不变指纹的案例会绿得毫无意义。

---

## 三个概念

| 概念 | 是什么 |
| --- | --- |
| **Task** | 自然语言目标 + 允许使用的能力 + **隐藏断言**。断言对被测 Agent 不可见 |
| **Sandbox** | 可复位的环境。复位不是一个选项，是前置条件 |
| **Verdict** | `pass` / `fail` / `unknown` + 首条失败原因 + 证据 |

一句话定位：**Agent 的考试局**。试卷（Task）公开，答案（断言）不公开，考场（Sandbox）每场一模一样。

---

## 规范视图：案例可移植的唯一前提

如果每条案例只认自己那套 API，案例就永远长在实现上，一换后端全废。

所以 agent-web 规定中间有一层**规范视图**（`agent-web/canonical-view`）。适配器负责把自己的系统投影成这个形状：

```js
{
  menu:       [{ id, dishName, price, category }],
  orders:     [{ id, username, status, totalAmount, pickupNo, createTime,
                 items: [{ dishName, count, unitPrice, subTotal }] }],
  status_log: [{ id, type, orderId, from, to, by, at }]
}
```

断言只写在这层上。同一份案例既能跑内存假系统，也能跑真实 HTTP 后端——**案例可移植，才谈得上对照**。

设计上有意放弃了 JSONPath：选实体（`selector`）和取字段（`path`）是两件事，分开写才能分别校验、分别报错。

```json
"selector": { "collection": "orders", "where": [{ "field": "status", "eq": "READY" }], "index": 0 }
```

---

## 视图是声明，不是默契

断言写在视图上，所以视图形状必须能校验。适配器在 manifest 里声明它：

```json
"view": {
  "version": "agent-web/view/1",
  "collections": {
    "orders":     { "kind": "list", "required": ["id", "status", "totalAmount", "items"] },
    "status_log": { "kind": "list", "required": ["type", "orderId", "from", "to"] }
  }
}
```

运行器在初态和终态各校验一次。不合格判 `unknown / invalid_environment`，写明缺哪个集合、哪个字段。

**这一条必须和「集合里没有实体」分开：**

| 情况 | 判决 | 是什么问题 |
| --- | --- | --- |
| 集合缺失、kind 不符、缺 required 字段 | `unknown / invalid_environment` | 适配器没按约定投影——**仪器坏了** |
| 集合在，但是空的 | 断言各自报 `missing_observation` | 观测到了，系统真的没数据 |
| 字段值不等于期望 | `fail` | 被测系统的**行为** |

三者混在一起时，"我接错字段了"会看起来像"这个系统什么都没有"，然后人去改断言，越改越错。

声明之后还有个副产品：`compare` 会比对两个适配器的视图契约。判决一致而契约不同，说明这份一致是碰巧——它们各自在不同的字段上被判，恰好结论相同。真正可比的一致，需要契约逐字相同。

---

## 身份是显式的

案例不写"用 token A"，写的是角色：

```json
{ "capability": "order.pick", "as": "customer2", "bindings": { "orderId": "$s1.orderId" } }
```

适配器负责把角色绑到具体身份上。内存适配器里 `customer → alice`，真实后端里 `customer → 当场新注册的账号`。

这条规则是被上面那个 bug 教出来的。**只要适配器有机会悄悄替换身份，案例就在撒谎。**

绑定语法是最小的一点点：`"$s1.orderId"` 取第 `s1` 步返回值里的字段。引用一步 `expected_outcome: "rejected"` 的返回值会让整条案例报 `invalid_case`——被拒绝的步没有返回值，硬取只能拿到 undefined。

---

## 复位：第三条被忽略的路

原计划里只想到两种复位方式：快照回滚（要能拍快照）、重新播种（要能清库）。这两种都很贵。

`identity` 是第三条，也是最便宜的一条：**应用本来就有账号体系的话，每条案例用全新账号，天然隔离，不需要清任何数据。**

咖啡店后端用的就是这条。一次 reset 建三个身份（主顾客、次顾客、店员），跑完不清理，各案例之间也互不干扰。代价是每次 reset 多三次注册——实测仍在一秒内。

```json
"reset_strategy": "identity"
```

它换来的是：同一套断言，既能在假系统上跑，也能在别人的生产级后端上跑，而不用碰数据。

---

## 七种断言

| kind | 相位 | 作用 |
| --- | --- | --- |
| `entity_exists` | final | 某集合里至少/恰好有 N 个实体 |
| `field_equals` | final | 选中实体的某字段等于某值 |
| `count_delta` | initial_vs_final | 某集合净变化量等于 delta |
| `unchanged` | initial_vs_final | 某观测域净变化为零 |
| `status_transition` | trace | 状态流水里出现了指定的迁移序列 |
| `event_absent` | trace | 某类事件全程不出现 |
| `composite` | — | `and` / `or` / `not` 组合上面任意几条 |

相位不是实现细节，是语义。`status_transition` 必须在流水上求值，放到终态上求值就会漏掉"中间走错了一步但最后又走回来了"。

**`unchanged` 只保证净变化为零，它不管中间动过没有。** 想禁中间行为要用 `event_absent`——这是两件不同的事，混在一起写会写出永远通过的断言。

`and` 用 Kleene 三值逻辑聚合：任意一条为假则整体为假，否则只要有一条未知则整体未知。

---

## 时间与挂死

`--timeout=MS` 给单条案例一个硬上限。适配器卡住时必须有判决：宁可 `unknown / infrastructure_error`，也不让整批跑挂死。默认不设上限，跑真实后端时建议给一个。

## 约束（宪法）

**没有 `llm_judge` 这个 kind，也不会加。**

一旦允许把判决权交给模型，断言集就退化成"模型觉得像"，这门东西就没有存在必要了。要做的是把目标拆到能用结构化断言表达的粒度上；拆不动的部分，诚实地标 `unknown`，不要糊过去。

---

## 现在不行的部分（诚实清单）

写出来是为了让人知道边界在哪，不是自谦。

1. **适配器要手写。** 目前没有"给个 URL 自动生成适配器"这种功能。有骨架可抄（[examples/adapter-template](examples/adapter-template/)），但"你的状态怎么投影成规范视图""哪条能力算 validated"这些判断仍然只能人来想。真实后端那个适配器是照着接口文档一条条写出来的，约 11KB。这是眼下最贵的一步。
2. **视图契约要手写，且没有跨视图的映射层。** 视图现在可以声明（`manifest.view`）并校验，但声明本身得人来写；两个适配器用了不同集合名时（一个叫 `orders`、一个叫 `tickets`），案例不会自动换算过去，只能各写一份。真正的可移植还差这一层。
3. **只判终态和流水，不判中间过程。** `event_absent` 能查事件，但"Agent 点了三次才点对"这类过程质量现在量不出来。
4. **`inferred` 证据等级没有提级路径。** manifest 里标了 `inferred` 的能力（比如需要 multipart 的图片上传）只能一直诚实地标着，没有从推断升到验证的流程。
5. **单适配器单 run 串行跑。** 没有并发，也没有跨机器分发。
6. **复杂度标签只是标签。** `complex` 由步数、写操作数、角色切换数算出来，不是难度标定，不要当难度用。
7. **`draft` 只会抄现状。** 它写不出「不该发生的事」——负例、禁止事件、时间上限，一条都不会自己冒出来。这些仍然只能人想，工具最多提醒你去想。

---

## 目录结构

```
agent-web/
├── bin/agent-web.mjs          命令行：selftest / verify / report / compare / record / draft / flow / drift / capabilities / init
├── src/
│   ├── three-valued.mjs       Kleene 三值逻辑（true / false / unknown 及其 and/or/not）
│   ├── values.mjs             归一化、深比较、稳定序列化、结构指纹
│   ├── select.mjs             实体选择器（collection + where + index）
│   ├── assert/kinds.mjs       七种断言的求值器
│   ├── assert/index.mjs       断言校验、相位表、聚合与首条失败提取
│   ├── case.mjs               案例格式校验、绑定解析、标签推导
│   ├── runner.mjs             六步判决流水线
│   ├── report.mjs             Wilson 区间、汇总指标、一致性、文本输出
│   ├── view.mjs               视图契约：声明校验、状态核对、跨实现差异
│   ├── record.mjs             流量 → 候选轨迹（http 模板反查、绑定推断）
│   ├── draft.mjs              轨迹 → 案例草稿（回放、断言合成、待确认清单）
│   ├── flow.mjs               案例/判决 → 自包含交互流程图 HTML
│   └── adapter/
│       ├── contract.mjs       适配器契约（manifest 校验、四种执行结果、证据等级）
│       ├── load.mjs           适配器加载（内置名 / 文件路径 / 包名）
│       ├── memory.mjs         确定性内存业务系统
│       └── taixianglian.mjs   真实 Spring Boot 咖啡店后端适配器
├── cases/
│   ├── memory-demo/           七条案例 + expected.json
│   └── taixianglian/          与上面除 adapter 外字节相同的七条
├── examples/
│   ├── README.md              参考被测系统（咖啡店）说明
│   ├── adapter-template/      能直接跑的适配器骨架 + 四条示例案例
│   └── agent-traces/          真实流量日志 → record 产物 → draft 草稿 → flow 流程图
├── docs/
│   ├── SPEC.md                案例格式规范
│   ├── FINDING-001.md         身份塌缩导致的假通过
│   └── FINDING-001.en.md      同上，英文版
└── test/engine.test.mjs       46 个单元测试（node --test，零依赖）
```

---

## 和别的东西的分工

- **不是 browser agent 模型。** 不管模型怎么操作界面，只管判它做对没有。
- **不是 RPA 录制回放。** 参考轨迹是给人写断言用的样本，不是要复刻的动作脚本。
- **不是通用爬虫。** 只碰授权给它的那一个系统。
- **不判"好不好看"。** 视觉与主观体验不在这套东西的射程内，硬要判就会滑回 LLM judge。

---

## 路线

- `0.1`：内存适配器 + 真实 HTTP 适配器 + 七种断言 + 跨适配器判决对照 + 视图契约，跑通。
- `0.2`：判别人的轨迹；事件词表；初态漂移检测。
- `0.3`：`record`——真实流量还原成候选轨迹。
- `0.4`：`draft`——轨迹回放成案例草稿，把「写案例」压成「确认几条待办」。
- `0.5`（当前）：`flow`——案例、候选轨迹、判决证据汇成一张离线交互流程图。
- 之后：跨视图映射（不同集合名的案例能换算过去）；多后端并发；`inferred` 提级路径。

---

## 许可

MIT。见 [LICENSE](LICENSE)。

---

## 参考

- 案例格式规范：[docs/SPEC.md](docs/SPEC.md)
- 假通过事故复盘：[docs/FINDING-001.md](docs/FINDING-001.md) · [English](docs/FINDING-001.en.md)
- English README: [README.en.md](README.en.md)

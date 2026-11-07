# agent-web 案例格式规范

版本：`agent-web/0.1`　状态：草案（实现已跑通，格式仍可能小改）

规范关键词：**必须**表示硬性要求，**应当**表示除非有理由否则要遵守，**可以**表示可选。

---

## 1. 顶层结构

一条案例是一个 JSON 对象。

```json
{
  "schema_version": "agent-web/0.1",
  "id": "<适配器>/<案例名>",
  "environment": { "adapter": "<适配器名>", "seed": {} },
  "task": { "...": "见第 3 节" },
  "reference_trajectory": [ "...见第 5 节" ],
  "observability": { "declared_scopes": ["menu", "orders", "status_log"] }
}
```

| 字段 | 类型 | 必须 | 说明 |
| --- | --- | --- | --- |
| `schema_version` | string | 是 | 固定 `agent-web/0.1` |
| `id` | string | 是 | `适配器/案例名` 形式，不要求与文件名相同 |
| `environment` | object | 是 | 见第 2 节 |
| `task` | object | 是 | 题目与断言，见第 3 节 |
| `reference_trajectory` | array | 是 | 参考轨迹，见第 5 节 |
| `observability` | object | 否 | 声明期望被观测的域 |

**本规范未定义的顶层字段必须被忽略。** 实现不得因为出现陌生字段就判 `invalid_case`——案例上会挂工具的注记（目前只有 `draft`，见 5.7），把它们当成格式错误会让「草稿」和「正式案例」没法放在同一个目录里。

校验失败时判决为 `unknown / invalid_case`，整条案例**不进入执行**。

---

## 2. `environment`

```json
{ "adapter": "taixianglian", "seed": { "menuVersion": 1 } }
```

- `adapter`：适配器名，用于人读与报告，实际执行的适配器由命令行 `--adapter=` 决定。
- `seed`：传给适配器 `reset(seed)` 的种子。同一份 `seed` 应当得到同一初态；做不到就必须在 manifest 里标 `reset_strategy` 说明。

**案例不得写死具体账号、令牌、主机名。** 身份一律走第 6 节的角色寻址。

`--adapter=` 接受三种写法，同一份案例换个写法就能打到不同实现上：

```
memory                                   内置名
./my-adapter.mjs                         文件路径（相对当前工作目录）
@acme/agent-web-adapter-order            包名
```

模块需导出 `createAdapter(options)`；也接受 `default` 导出或直接导出 `manifest/reset/observe/execute`。加载后按第 6 节校验契约，不合格直接报错而不是带着半个适配器往下跑。

---

## 3. `task`

```json
{
  "natural_goal": "顾客点一杯拿铁，店员接单、做好，顾客本人取走。",
  "allowed_capabilities": ["order.create", "kitchen.accept"],
  "preconditions": [ "...断言..." ],
  "goal_assertions": [ "...断言..." ],
  "invariants": [ "...断言..." ]
}
```

| 字段 | 必须 | 说明 |
| --- | --- | --- |
| `natural_goal` | 是 | 给人看的目标描述。**判决不看它**，它只是文案 |
| `allowed_capabilities` | 否 | 白名单。省略表示 manifest 里全部允许 |
| `preconditions` | 否 | 在初态上求值，`fail` 一律降级为 `unknown / invalid_initial_state` |
| `goal_assertions` | 是 | 主判决依据 |
| `invariants` | 否 | 全程必须成立，违反判 `fail / invariant_violated` |

`natural_goal` 与断言之间没有自动对应关系。断言写错了，判决就错了——这一点无法靠格式约束消除，只能靠跨实现对照发现（见 README）。

---

## 4. 断言

```json
{
  "kind": "field_equals",
  "selector": { "collection": "orders", "index": 0 },
  "path": "status",
  "value": "PICKED"
}
```

### 4.1 二十种 kind

| kind | 必填参数 | 相位 |
| --- | --- | --- |
| `entity_exists` | `selector`, `min?`(默认 1), `exact?` | final |
| `field_equals` | `selector`, `path`, `value` | final |
| `count_delta` | `selector`, `delta` | initial_vs_final |
| `unchanged` | `scopes`(观测域名数组) | initial_vs_final |
| `status_transition` | `selector`, `path`, `transitions`(二元组数组) | trace |
| `event_absent` | `type` 或 `selector` | trace |
| `composite` | `op`(`and`/`or`/`not`), `args` | 由子断言决定 |
| `relation` | `op`, 见 4.2 | final |
| `unique` | `selector`, `path` | final |
| `type_of` | `selector`, `path`, `type` | final |
| `subset` | `selector`, `path`, `values` | final |
| `sorted_by` | `selector`, `path`, `order?`(`asc`/`desc`) | final |
| `window` | `from_step`, `to_step`, `of` | trace（套内层） |
| `every_step` | `of` | trace（套内层） |
| `pagination` | `collection`, `steps`, `total`, `pageSize?`, `ordered_by?` | final |
| `payload` | `step`, `path`, `op`, `value?` | trace |
| `linkage` | `selector`, `expect` | final |
| `timeliness` | `from`, `to`, `max`, `timezone` | final |
| `state_machine` | `walk`, `selector`, `path`, `states`, `transitions` | trace |
| `recurrence` | `selector`, `field`, `every`, `from`, `to`, `timezone`, `tolerance_ms?`, `expect_count?` | final |

**没有 `llm_judge`，也不接受自定义扩展 kind。** 未知 kind 一律 `invalid_case`。

### 4.2 relation：字段之间的关系

前七种只能写「这个字段等于这个值」「这个集合多了几条」。真实系统里最值钱的判据
往往是**字段之间的关系**，写死具体值反而把案例绑到了某个实现上。

| op | 必填 | 含义 |
| --- | --- | --- |
| `eq` | `left`, `right` | 同一实体上两个字段必须相等 |
| `sum_equals` | `items`, `of`, `path` | 明细数组某项之和 == 实体字段（如 `totalAmount == Σ items.subTotal`） |
| `product_equals` | `items`, `left`, `right`, `path` | 每条明细满足 `path == left × right`（如 `subTotal == unitPrice × count`） |
| `sorted` | `path` | 集合该字段单调不减（如取餐号不会倒着发） |

相位**只能是 final**。中途的关系往往合法地不成立（订单刚建、总额还没算那一瞬间），
按 trace 求值会把正常实现判红 —— 这是它和 `status_transition` 的关键差别。

四条规则：

1. 元素缺失或类型不对时判 `unknown / missing_observation`，**不判假**。判不了就是判不了。
2. 违反时判 `FALSE / relation_violated`，message 必须写出两边的实际数值。
3. 只收**结构性**关系（任何一次运行上都应成立），不收统计式不变式（在 N 次运行里成立过）。
4. `draft` 提议关系式前必须先验证：不在这条轨迹上成立的关系，一条也不提。

为什么要这第八种 kind：只在「拿铁 ×1」的单子上断言金额，等于没断言金额 ——
「漏乘数量」和「正确算法」在数量为 1 时算出同一个数。关系式不吃这个亏：
它在数量为 1 时同样要求 `subTotal == unitPrice × count`，数量为 3 时直接把它抓出来。

### 4.3 `window` 与 `every_step`：换个观察口

`unchanged` / `count_delta` 只看首尾，`status_transition` 只看状态序列。有一类故障刚好躲在这两者之间：
**中途坏掉、结尾修好**，或者**被拒绝那一步之后留了半条记录、收尾时又抹掉**。
净变化为零、终态干净，现有断言全判 `TRUE`。这两种 kind 不是「更严格」，是把观察范围缩小。

```json
{ "kind": "window", "from_step": 2, "to_step": 3,
  "of": { "kind": "unchanged", "scopes": ["status_log"] } }

{ "kind": "every_step", "of": { "kind": "unchanged", "scopes": ["menu"] } }
```

| kind | 求值范围 | 内层允许 | 相位 |
| --- | --- | --- | --- |
| `window` | `[from_step, to_step)` 这一段：`initial` 取该段起点状态，`final` 取终点状态 | `unchanged` / `count_delta` / `field_equals` / `entity_exists` | 只能 `trace` |
| `every_step` | 每一步：「起点 → 这一步之后」 | 同上（含 `composite` 之外的全部终态类断言） | 只能 `trace` |

四条规则：

1. `from_step` / `to_step` 越界、方向反了、或该步的状态没记录 —— 判 `unknown / invalid_case` 或 `missing_observation`，**不许猜**。
2. `every_step` 的参照是**起点**不是上一步 —— 否则「每步都在变」的东西永远判不了。
3. 两种都只允许 `trace` 相位。写成 `final` 等于把窗口丢掉，校验期直接拒收。
4. 新增这两个 kind 的前提是各自有**独占杀手**：`m-transient-menu-price`（只有 `every_step` 抓得住）与
   `m-mid-write-leak`（只有 `window` 抓得住），由 `scripts/kind-necessity.mjs` 每次跑一遍验证。

实现细节：状态层变异体拿到的 `tamper(state, index, count)` 现在带下标，
这样它才能只坏「中间那一步」而不碰首尾 —— 没有这个下标，上面两个故障根本造不出来。
代价是这类变异体只能在快路径里复现（`observe` 包装拿不到步号），所以它们在 meta 里标 `requires_trace: true`，
`scripts/state-equivalence.mjs` 会跳过并列出来。

### 4.3.1 pagination：页与页之间的事

时间窗管「某一段」，每步求值管「每一步」，分页管「几页拼起来对不对」。
四种坏法（跨页重复、边界丢行、翻页乱序、`total` 说谎）全都藏在页与页之间：
单看任何一页都是好的，逐页的 `count_delta` 也都是对的。

```json
{ "kind": "pagination", "collection": "orders", "steps": [6, 7, 8],
  "total": 5, "pageSize": 2, "ordered_by": "id" }
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `steps` | 是 | 翻页那几步的**步号（1 基）**，至少两个，与 `window` 同一套坐标 |
| `collection` | 否 | 返回体里的键名。省略时要求返回体本身是数组；兼容 `{data:{orders:[…]}}` |
| `total` | 否 | 声称的总条数。给了就要求各页加起来正好等于它 |
| `pageSize` | 否 | 每页条数。给了就要求非末页必须是满的 |
| `ordered_by` | 否 | 排序字段；给了就要求按页次拼接后单调不减，查重也用它当主键 |
| `id_field` | 否 | 单独指定查重字段（缺省用 `ordered_by`） |

**数据来源是 `trace[i].payload`，不是规范视图。** 视图是整份状态快照，
一条翻过页的列表在视图里和没翻过一模一样 —— 拿视图判分页，永远判不出来。
所以 `probe` 的 ctx 带 payload（录制适配器记下每次执行的返回），
而证据（`verdict.evidence.trace`）仍然只留 outcome/identity/error，不夹带业务数据。

返回码：`pagination_duplicate` / `pagination_size` / `pagination_total` / `pagination_order`。
取不到返回体、步不存在、行里没有排序字段一律 `unknown`（`missing_observation`），不判假。

### 4.4 相位

相位决定求值时机，是语义的一部分：

- `final`：终态上求值。
- `initial_vs_final`：比较初态与终态。
- `trace`：在状态流水上求值。

把 `trace` 类断言放到终态上求值会漏掉"中间走错又走回来"，因此**实现必须按相位表求值，案例不得指定相位**。

### 4.5 `selector`

```json
{ "collection": "orders", "where": [{ "field": "status", "eq": "READY" }], "index": 0 }
```

- `collection`：观测域里的集合名。
- `where`：可选，谓词数组，全部满足才算命中。
- `index`：可选，命中集合里的下标；省略表示"全部命中"。

谓词运算：`eq` `ne` `in` `exists` `gt` `lt` `gte` `lte` `contains`。

选中 0 个实体 → 断言为 `unknown / missing_observation`，**不是** `false`。空集不构成反证。

### 4.6 `path`

点号路径，从实体根写起：`status`、`items.length`、`items.0.count`。`length` 是特殊键，取数组长度。

取值不存在 → 断言为 `unknown`（观测不足），不是 `false`。

---

### 4.7 形状断言：唯一性、类型、值域、顺序

前八种都在说「第几行的第几个字段等于什么」。真正难表达的是这四句：

| kind | 必填 | 说的是 |
| --- | --- | --- |
| `unique` | `selector`, `path` | 这批行里这个字段互不重复 |
| `type_of` | `selector`, `path`, `type` | 这批行里这个字段都是这个类型 |
| `subset` | `selector`, `path`, `values` | 这批行里这个字段的值都在允许集合里 |
| `sorted_by` | `selector`, `path`, `order?` | 这个序列按该字段升/降序 |

它们断的是**集合的结构**，不是某一行的取值，所以行号换了也照样成立 —— 这一点让它们
比 `field_equals` 耐移植得多。

四条规则：

1. 缺字段、集合不存在、行数不够（`sorted_by` 少于 2 行）一律 `unknown / missing_observation`，
   不判假。空集合上的结构断言没有意义。
2. `type_of` 的 `null` 一律放过：字段缺失与字段是 `null` 在跨实现时无法区分。
3. `sorted_by` 相等不算违反 —— 稳定排序会保留相等元素。
4. 违反时 `FALSE / shape_violated`，message 必须指出是哪一行、哪个值。

**必要性是硬的。** 每加一种 kind 必须能被 `certify` 杀掉至少一个变异体，而且至少有一个
变异体只有它能杀。`scripts/kind-necessity.mjs` 就在跑这件事：

```
PASS  unique     能杀 1 个：m-duplicate-row        只有它能杀：m-duplicate-row
PASS  type_of    能杀 1 个：m-stringly-total       只有它能杀：m-stringly-total
PASS  subset     能杀 1 个：m-status-off-enum      只有它能杀：m-status-off-enum
PASS  sorted_by  能杀 2 个：…                       只有它能杀：m-unsorted-orders
```

四个新变异体是照着「只有这几种断言能抓」设计的。比如 `m-duplicate-row` 把最后一行
覆盖成第一行的副本 —— **条数不变**。如果它只是多插一行，`count_delta` 也会抓到它，
`unique` 就永远拿不到独占战功，那它就不该存在。

`pagination` 想过，没收：规范视图不携带分页元信息，写出来杀不掉任何变异体，是装饰。

### 4.8 形状断言的边界：一条实测

`cases/coffee/shape.json` 里**没有** `sorted_by`，只有另外三种。原因是实测出来的：

```
memory 适配器          → pass
真实咖啡店后端 (8180)  → fail（第 0 行比第 1 行新）
```

两边都没把「列表按什么排」写进契约。这时候断言升序不是抓到了 bug，是**自己造了一个假红**。
所以它被挪到 `examples/shape-order/`，只对 mock 跑，当一个用法示范。

这和 `m-pickup-no-offset`（取餐号偏移 100）是同一类：**能被观测到，不等于值得被断言**。

### 4.3.2 payload：返回体断言

前十七种断言读的都是**规范视图**（那份「此刻系统里有什么」的快照）。`payload` 读的是
**每一步的响应体**——视图里没有 token、没有分页信封、没有请求回执，这些只能从返回体看。

```json
{"kind": "payload", "step": 3, "path": "$.orders", "op": "count_gte", "value": 2}
```

| 字段 | 说明 |
|---|---|
| `step` | 1 基步号，与 `window` / `pagination` 同一套坐标 |
| `path` | 简化 JSONPath：`$.a.b[0].c`（数组下标只支持数字） |
| `op` | `exists` / `equals` / `is_string` / `is_list` / `not_empty` / `count_gte` / `count_equals` / `contains` |
| `value` | `exists`/`is_string`/`is_list`/`not_empty` 之外必填 |

**相位只能是 `trace`**：返回体只属于某一步，拿去和终态比没有意义。

**看不到返回体时是 `unknown`，不是 `fail`** —— 适配器 `execute` 必须回 `payload`，否则
这条断言只能判「看不见」。这是有意的：把「不知道」写成「不通过」会让实现背黑锅。

它的独占杀手是 `m-payload-truncate`（执行成功后把返回体里每个顶层数组砍掉一行）：
状态完全正确，只有响应体坏。`scripts/kind-necessity.mjs` 每次都会验这一条。

## 5. 参考轨迹

```json
[
  { "id": "s1", "capability": "order.create", "as": "customer",
    "expected_outcome": "applied", "arguments": { "items": [{ "dishName": "拿铁", "qty": 1 }] } },
  { "id": "s2", "capability": "kitchen.accept", "as": "staff",
    "expected_outcome": "applied", "bindings": { "orderId": "$s1.orderId" } }
]
```

| 字段 | 必须 | 说明 |
| --- | --- | --- |
| `id` | 是 | 步标识，案例内唯一，供绑定引用 |
| `capability` | 是 | 必须出现在 manifest 里，否则判 `unknown / coverage_gap` |
| `as` | 是 | **角色名**，不是账号名。适配器负责把角色绑到具体身份 |
| `expected_outcome` | 是 | `applied` 或 `rejected`；省略按 `applied` |
| `arguments` | 否 | 直接传给适配器的参数 |
| `bindings` | 否 | 形态同 `arguments`，值可以是绑定表达式 |

参考轨迹是**给人写断言用的样本**，不是必须复刻的动作脚本。被测 Agent 可以走别的路径，只要终态与流水满足断言。

### 5.1 绑定表达式

`"$<步id>.<字段名>"`，取该步返回载荷里的字段。

规则：

- 引用的步必须在当前步**之前**出现。
- 引用 `expected_outcome: "rejected"` 的步 → 整条案例 `invalid_case`。被拒绝的步没有返回值，硬取只能拿到 `undefined`，静默降级成空参数会让后面的判决全部失真。
- 引用的字段在返回载荷里不存在 → `fail / invalid_action`。

### 5.2 被拒绝的步

`expected_outcome: "rejected"` 表示"这一步**应当**被系统拒绝"。适配器返回 `applied` 时判 `fail / expected_rejection`。

这是负例的写法：不写"什么都不做"，写"做一件应当被挡下的事，然后确认真的被挡下了"。

---

## 5.4 候选轨迹（判别人的轨迹）

`reference_trajectory` 描述「这条路能走通」；候选轨迹描述「某个 Agent 实际走了哪条路」。两者结构完全相同，同一套校验、同一个 `judge`。

CLI 用法：`verify <案例目录> --adapter=X --trajectory=<轨迹目录>`，按**同名**匹配：`cases/x/happy-path.json` 对应 `trajectory/happy-path.json`。

轨迹文件两种形状都接受：一个带 `produced_by` 与 `trajectory` 的对象，或直接一个数组。

规则：
- 有候选轨迹就判它，`verdict.trajectory_source = "candidate"`；没有才判参考轨迹（`"reference"`）。
- 候选轨迹先过结构校验，不过则 `unknown / invalid_case`，不进入执行。
- `bindings` 在候选轨迹里同样可用（Agent 若已拿到具体 id 就直接写值）。
- 判决跟着轨迹走，不跟着案例走：同一份案例，参考轨迹 fail 而候选轨迹 pass 是**正常结果**，它恰好说明断言测的是目标达成，不是动作复刻。

---

## 5.5 漂移检测

```bash
agent-web verify cases/x --adapter=X --out=before.jsonl
agent-web drift before.jsonl after.jsonl
```

`drift` 比较两批判决里 `evidence.initial` 的**规范视图指纹**（`fnv1a32:` 前缀）：一致 / 漂移 / 只在旧 / 只在新。有漂移则退出码 1。

漂移不是判决错误，而是「这份案例还描不描述当初那个应用」的问题——被测系统改了菜单、改了字段形状，案例不改就会静默失真。指纹在读取时现算，不落盘，避免陈旧字段。

---

## 5.6 record：把流量还原成轨迹

```bash
agent-web record <日志> --adapter=SPEC --out=<文件> [--case=<案例 id>] [--include-reads]
```

- 反查能力：拿 `method + path` 匹配 manifest 里各能力的 `http` 模板；路径模板匹配，`{param}` 捕获成参数。
- 反查参数：优先用适配器的 `toStep`；没有就用捕获到的路径参数。
- 结局判定：业务码 `200` → `applied`；`40000–49999` → `rejected`；**`40100–40199` 与其余一切 → 不录**（认证失败和连不上是环境问题，记成 `rejected` 会把环境故障算成 Agent 的错）。
- 绑定推断：参数值等于之前某步返回的实体 id，改写成 `$sN.orderId`。**只认第一个产出者**——后续步骤回显同一个 id 不改写，否则绑定会串成传递链。
- 读操作默认不录；`--include-reads` 打开。
- 无法还原的条目进 `skipped`，带 `reason`，不静默丢弃。

产物就是一个普通的轨迹文件，交给 `verify --trajectory` 直接用。

---

## 5.7 draft：从轨迹反推案例草稿

```bash
agent-web draft <轨迹文件> --adapter=SPEC [--out=<案例.json>] [--id=<案例 id>] [--goal="..."]
```

回放一次：`reset` → 逐步 `execute` → `observe` 终态，语义与 runner 一致。**任何一步中断都不生成草稿**——跑不通就没有「实际终态」可依据，继续往下写出来的全是想象。

合成规则是确定性的，没有模型参与：

| 观测 | 产出 | 相位 |
| --- | --- | --- |
| 某集合条数变了 | `count_delta`（delta 取实际净变化） | initial_vs_final |
| 恰好一条新实体 | 对「相对首次观测发生变化」的字段写 `field_equals`，最多 4 条，`status` 优先 | final |
| 该实体的 status 序列长度 ≥ 2 | `status_transition`（transitions 取相邻边） | trace |
| 全程未变且非空的集合 | `unchanged`，写进 `invariants` 而不是 `goal_assertions` | initial_vs_final |

不生成的四类，一律进 `draft.todo` 并写明原因：

- **环境相关字段**：`id` / `*Id` / `*_id` / `createTime` / `pickupNo` / `username` 等。换一次 reset 就变，写进断言等于把案例钉死在这一场运行上。绑定表达式能处理它们，断言不能。
- **事件流水的条数**（`manifest.events_scope`）：条数依赖实现记多细。
- **多条新实体**：挑哪一条当判据属于业务判断。
- **终态消失的实体**：草稿只看得到「少了」，看不到「该不该少」。

`status_transition` 的序列取法与求值器逐字相同（按 `step.stateAfter` 取、去连续重复），所以草稿一定能重放。这一点是刻意的：草稿的用途是「可确认」，不是「可发现」。

**草稿必须带着未确认标记。** 产物里有一个 `draft` 顶层块：

```json
"draft": {
  "status": "unconfirmed",
  "generated_by": "agent-web draft",
  "from": "examples/agent-traces/recorded/happy-path.json",
  "initial_fingerprint": "fnv1a32:f584a774",
  "final_fingerprint": "fnv1a32:f9721fb8",
  "collections": [{ "collection": "orders", "before": 0, "after": 1, "delta": 1 }],
  "notes": [{ "at": "goal[1]", "why": "orders 的 status 停在 \"PICKED\"（这是本次运行的终点，不代表它应该停在这里）" }],
  "todo": ["……"]
}
```

`draft` 是非规范的注记块，实现必须忽略（见第 1 节）。人工确认后应删掉它，这条案例才算接手。

**产物一定是 `pass`。** 断言从这次运行的终态抄下来，回放当然过。这不是「草稿对了」，是「草稿同义反复」。工具必须把这句话打进输出，否则下一个人会把它当判据用。

`allowed_capabilities` 取轨迹里出现过的**全部**能力，包括 `expected_outcome: "rejected"` 的步。runner 在调用适配器之前先查白名单（第 7 节第 8 条），少写一条，负例会在「系统拒绝它」之前就被判成 `invalid_action`——负例被自己的白名单挡在门外。

---

## 5.8 accept：草稿转正

`draft` 产出的案例带 `draft.status: "unconfirmed"`，判决阶段会被拦在第 2 条（见 7）。转正需要一次可指认的确认：

```bash
node bin/agent-web.mjs accept <案例文件> --by=<确认人> [--at=<ISO 时间>]
```

确认后写入：

| 字段 | 值 |
| --- | --- |
| `draft.status` | `confirmed` |
| `draft.reviewed_by` | 由 `--by` 给定，为空则拒绝写入 |
| `draft.reviewed_at` | 由 `--at` 给定，缺省为当前时间（ISO 8601） |

不提供"匿名确认"：没有署名的确认与没有确认等价。

## 6. 适配器契约

适配器是普通对象，必须实现：

```js
{
  manifest(): Manifest,
  reset(seed): Promise<{ runId, state }>,
  observe(runId): Promise<{ state, missingScopes }>,
  execute(runId, action): Promise<Outcome>,
  close(runId): Promise<void>
}
```

`Outcome` 五选一：

| outcome | 含义 |
| --- | --- |
| `applied` | 执行成功，`payload` 带返回值 |
| `rejected` | 业务层拒绝（越权、非法迁移、参数不合法），`error.code` 必填 |
| `unsupported` | 适配器演不了这个能力（**不是**失败） |
| `infra_error` | 适配器自己坏了（网络、令牌过期、解析失败），**这次调用没发生** |
| `may_have_committed` | 请求发出去了，结果没回来——**可能已经生效** |

区分 `rejected` 与 `infra_error` 很关键：前者是**被测系统的行为**，后者是**测量仪器故障**。把仪器故障记成"系统拒绝"会凭空造出一次假失败。

`may_have_committed` 与 `infra_error` 同样必须分开，但方向相反：
这两档在判决上都是 `unknown`，区别在**重放指令**——
`infra_error` 说"可以重试"，`may_have_committed` 说"不许重试，先去看状态"。
写请求超时、连接断在收到响应头之前、后端 5xx 都属后者。塞进 `infra_error`，
判决看不出问题，重放器却会照着重跑，把已经扣了的钱再扣一次。

`close(runId)` 必须**幂等**：重复调用不得抛错，也不得让第二次的失败看起来像被测系统坏了。
理由很实际——不幂等的清理函数逼每个调用方自己记账，而调用方记账的地方通常就是重试路径。
`probe` 有一条 `close-idempotent` 专门查这个。

### 6.1 Manifest

```json
{
  "adapter": "memory",
  "adapter_version": "1.0.0",
  "reset_strategy": "snapshot",
  "description": "确定性内存业务系统",
  "scopes": ["menu", "orders", "status_log"],
  "events_complete": true,
  "events_types": ["order.created", "order.making", "order.ready"],
  "events_scope": "status_log",
  "canonical_view": "agent-web/canonical-view",
  "roles": ["customer", "customer2", "staff"],
  "capabilities": [
    { "id": "order.pick", "kind": "write", "evidence_level": "validated",
      "args": { "orderId": "number" }, "roles": ["customer"] }
  ]
}
```

- `reset_strategy`：`snapshot` / `reseed` / `identity`，声明初态怎么来的。
- `http`：可选，这个能力对应的 HTTP 形状，写法 ``METHOD /path/{param}``。`record` 靠它把真实请求反查回能力。没有它就录不到——日志里出现未声明的请求一律进 `skipped`。
- `toStep(entry, matched)`：适配器可选方法，把一条请求还原成案例参数（返回 `null` 表示认不出）。**为什么放在适配器里**：`dishList → items` 这种映射属于实现知识，核心不该知道。
- `events_types`：可选，声明本适配器**确实记录**的事件类型。断言里出现不在词表内的 `type` 时，`event_absent` 判 `unknown / unsupported_event`，绝不返回 TRUE。**词表把 `events_complete` 的承诺限定在真实存在的类型上**：应用压根不记「下单」这类事件时，若不声明词表，「没查到我下单的记录」会被误读成「没有下过单」。未声明词表则退回只看 `events_complete` 的老语义。
- `events_complete`：`true` 表示事件流水是完整记录。为 `false` 时 `event_absent` 类断言必须判 `unknown`——没记全就不能说"没发生过"。
- `evidence_level`：`observed`（亲眼看到）/ `inferred`（从接口推出来）/ `validated`（端到端验证过）。**这是给人看的诚实标记，判决不用它。**
- `roles`：适配器能绑定的全部角色。案例里的 `as` 必须落在这个列表里，否则适配器返回 `rejected / unknown_role`（见 6.2）。
- `view`：视图契约，声明观测结果的形状。可选，但一旦声明就必须合法，运行器会拿它核对初态与终态（见 6.3）。

manifest 校验失败 → `unknown / invalid_environment`。

---

### 6.2 角色与身份

`reset()` 除了 `runId` 与 `state`，**应当**返回 `roleBindings`：角色名 → 身份标识的映射。

```js
{ runId, state, roleBindings: { customer: 'alice', customer2: 'bob', staff: 'barista' } }
```

运行器校验这张表**必须是单射**：任意两个角色指向同一个身份 → `unknown / invalid_environment`。理由见 `docs/FINDING-001.md`：角色塌缩会让案例测的变成另一个人的行为，而判决依然是绿色。

`as` 用了 `manifest.roles` 之外的角色 → 适配器返回 `rejected / unknown_role`。**不允许**回落到某个默认身份。

---

### 6.3 视图契约

视图是可声明的。断言写在视图上，所以视图形状不能靠默契。

```json
"view": {
  "version": "agent-web/view/1",
  "collections": {
    "orders":     { "kind": "list", "required": ["id", "status", "totalAmount", "items"], "semantics": "订单" },
    "status_log": { "kind": "list", "required": ["type", "orderId", "from", "to"],      "semantics": "状态流水" }
  }
}
```

| 字段 | 必须 | 说明 |
| --- | --- | --- |
| `version` | 是 | 固定 `agent-web/view/1` |
| `collections` | 是 | 非空对象，键是观测域里的集合名，支持点号路径 |
| `collections[].kind` | 是 | `list` / `object` / `scalar` |
| `collections[].required` | 否 | 每个实体必须具备的字段名数组 |
| `collections[].semantics` | 否 | 一句话说明这个集合是什么，给人读 |

**`view` 整体可选，但一旦声明就必须合法。** 半份契约比没有契约更危险：读的人会以为已经校验过了。

校验时机：`reset()` 后的初态、轨迹结束后的终态，各校验一次。不合规判 `unknown / invalid_environment`，`detail` 写明缺哪个集合、哪个字段，并附 `view_errors` 明细。

这条判决必须和「集合里没有实体」分开：

| 情况 | 判决 | 含义 |
| --- | --- | --- |
| 集合缺失 / kind 不符 / 缺 required 字段 | `unknown / invalid_environment` | 适配器没按约定投影，是**仪器问题** |
| 集合存在但为空 | 由断言各自报 `missing_observation` | 观测到了，被测系统真的没有数据 |
| 字段值不等于期望 | `fail` | 这才是被测系统的**行为** |

三者混在一起时，「我接错字段了」会看起来像「这个系统什么都没有」，然后你去改断言——越改越错。

集合的值显式为 `null` 表示"这个域这次没有"，不算违约。`undefined` 才算。

`agent-web compare` 会比对两个适配器的 `view`：判决一致而契约不同，说明这份一致是碰巧，不是等价。

---

### 6.4 安全边界：加载适配器即执行代码

适配器 SPEC 为文件路径或包名时，实现必须以动态 `import()` 加载它。这意味着：

- 适配器代码在**加载时刻**就以宿主进程的身份执行，早于任何复位、任何断言
- 它可以访问环境变量（含凭证）、文件系统与网络
- 本规范不要求沙箱，也不要求签名；它要求的是**在加载前把这件事说出来**

实现必须在 import 之前向 stderr 输出一条提示，说明「这是可执行代码，只加载可信文件」，并提供一个环境变量（本项目为 `AGENT_WEB_QUIET_ADAPTER_WARNING=1`）供已确认的调用方关闭。内置适配器不触发该提示。

这一条没有折中选项：不提示的实现会让「跑一份下载来的案例集」变成一次看不见的远程代码执行。

---

## 7. 判决顺序

实现必须按以下顺序判定，先命中先返回。顺序本身是规范的一部分：它决定了多个问题同时存在时报哪一个。

| # | 条件 | 判决 | reason_code |
| --- | --- | --- | --- |
| 1 | 案例格式校验失败 | unknown | `invalid_case` |
| 2 | 案例是未确认草稿（`draft.status` 存在且不是 `confirmed`） | unknown | `unconfirmed_draft` |
| 3 | `manifest()` 抛错 | unknown | `invalid_environment` |
| 4 | manifest 不符合契约 | unknown | `invalid_environment` |
| 5 | 复位后观测不到初态 | unknown | `missing_observation` |
| 6 | 前置条件为假 | unknown | `invalid_initial_state` |
| 7 | 前置条件无法求值 | unknown | `missing_observation` |
| 8 | 步的能力不在 manifest | unknown | `coverage_gap` |
| 9 | 步的能力不在 `allowed_capabilities` | fail | `invalid_action` |
| 10 | 参数绑定失败 | fail | `invalid_action` |
| 11 | 适配器返回契约外的 `outcome` | unknown | `contract_violation` |
| 11a | 适配器返回 `may_have_committed` | unknown | `effect_uncertain` |
| 11b | 适配器返回 `unsupported` | unknown | `coverage_gap` |
| 12 | 适配器返回 `infra_error` | unknown | `infrastructure_error` |
| 13 | 应成功却被拒绝 | fail | `unexpected_rejection` |
| 14 | 应被拒绝却成功了 | fail | `expected_rejection` |
| 15 | 目标断言为假 | fail | `assertion_false` |
| 16 | 不变量为假 | fail | `invariant_violated` |
| 17 | 任一断言为 unknown | unknown | `missing_observation`（若所有判不了的断言原因相同且在白名单内，用该原因，例如 `unsupported_event`） |
| 18 | 全部成立 | pass | `ok` |
| — | 未捕获异常 | unknown | `infrastructure_error` |

注意 11a：**`may_have_committed` 与 `infra_error` 判的都是 `unknown`，但理由码必须分开**。
前者说「请求发出去了，结果没回来，可能已经生效」，后者说「这次调用没发生」——
这是两条**相反**的重放指令：`infrastructure_error` 允许重试，`effect_uncertain` 不许。
合成一个码，重放器只能猜；猜错就是把已经扣了的钱再扣一次。
三种真实情形会落到这一档：写请求超时、连接断在收到响应头之前、后端 5xx。
适配器回这一档时，**后续步骤一律不执行**——拿一个不确定是否存在的 id 去执行下一步，
会把「一个不确定」扩散成「一串不确定」。

注意 11：**契约外的 outcome 必须拦在分类之前**。旧版四个分支（`unsupported` / `infra_error` /
应拒却成 / 应成却拒）全不命中时，这一步既不失败也不 unknown，会一路滑到终态断言——
而终态断言可能正好成立，判决就 `pass` 了。适配器回一个拼错的 `'applied '`、
大写 `'APPLIED'`、或读起来很合理的 `'success'`，全都能过。这不是适配器写错，
是**判定权威被悄悄换掉**：验的不再是契约，而是「这个值恰好没被任何分支拦下」。
所以它判 `unknown`（这一步做成了没有，无法判断），不是 `rejected`。
现场证据见 `docs/museum/e07-contract-violation.mjs`。

**注意 11 的落点必须是唯一一份实现。** 上表第 11 至 14 条合起来就是「一步的结局分类」，它只能有一份代码（`src/step-outcome.mjs` 的 `classifyStepOutcome()`），判决路径（`src/runner.mjs`）与录制回放路径（`src/draft.mjs`）都调它。这条要求写进规范，是因为它已经违反过一次：v0.60.0 只修了判决路径，回放路径里的手抄副本带着同一个洞活了一个版本，`test/step-outcome.test.mjs` 现在会扫两个文件的源码把这件事钉住。现场证据见 `docs/museum/e08-second-place.mjs`。

同一条道理适用于**「哪些理由码算作判决不成立」**：这个判据必须写成集合，不能写成「等于某一个码」。`traps` 原先把 `unusable` 写成「`reason_code === 'infrastructure_error'`」，新加的两个未知码因此被算进盲区——把「这一次什么都没测成」报成「测了但看不出来」，方向正好相反。

注意 5 与 16 的不对称：**前置条件为假判 unknown 而不是 fail**。初态不干净是环境问题，不是被测系统的错。把环境问题记成 fail，会把噪声算进被测对象头上。

注意 2：**未确认草稿不判 pass 也不判 fail，判 unknown**。它还不是一张考卷，没有资格得分。让机器生成的案例直接进判决，等于让写案例的模型给自己出题。

注意 14 优先于 16：一步该成功却被挡下，就没必要再评速度与终态了，首因更清楚。

注意 17 的理由码细化：断言层比判决层更清楚「为什么不知道」。当**所有**判不了的断言给出同一个原因，且该原因属于白名单（目前只有 `unsupported_event`），判决理由码就用它。白名单是封闭的——「后端不记录这类事件」和「观测是空的」是两件不同的事，前者要改适配器，后者要补观测，混成一个代码就没人能据此行动。

---

## 8. 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 全部判决与预期一致 |
| 1 | 存在不一致（含 unknown 与预期不符） |
| 2 | 用法错误、路径不存在、适配器名未知 |

`unknown` 计为不一致：拿不准就当红灯，别当绿灯。

这张表从 v0.7.0 起把「用法错误」写成 `3`，而 `bin/agent-web.mjs` 里 62 处 `return 2`、一处 `return 3` 都没有，`--help` 印的也是 `2`。**规范与实现不一致了四十多个版本，没有任何测试拦它**——因为退出码只在各命令自己的测试里按需断言，没人拿这张表当出处。现在改回 `2`，并加 `test/exit-codes.test.mjs` 把「表里写的码 = 代码真的返回的码」钉住：它扫 `bin/agent-web.mjs` 里所有字面量退出码，任何一个不在表里的码都会红。新增一种退出码因此变成了规范变更，必须同时改这张表。

---

## 9. 假绿审计（audit）

`audit` 不属于案例格式，它是对**判决本身**的度量：拿一份可信判决当 oracle，量另一份判决错在哪。

```bash
node bin/agent-web.mjs audit <可信结果.jsonl> <被审结果.jsonl> [--detail] [--json]
```

两份输入都是 `verify --out=` 产出的 JSONL。判定规则：

| 条件 | 归类 |
| --- | --- |
| oracle 与候选都 `pass` | 一致·通过 |
| 都 `fail` | 一致·未通过 |
| oracle `fail`、候选 `pass` | **假绿** |
| oracle `pass`、候选 `fail` | 假红 |
| oracle 可判、候选 `unknown` | 漏判 |
| oracle `unknown`、候选可判 | 仅候选敢判（不计入比率） |
| 双方都 `unknown` | 双方都无法判断 |

比率：

- `判决一致率 = (一致通过 + 一致未通过) / 都能判`
- `假绿率 = 假绿 / (假绿 + 一致未通过)`
- `假红率 = 假红 / (假红 + 一致通过)`
- `漏判率 = 漏判 / oracle 判得出的案例数`

分母为 0 时比率为 `null`，显示为「—」，**不得显示为 0%**——0/0 与 0/100 是两件事。

退出码：假绿为 0 时返回 0，否则返回 1。**只有假绿影响退出码**，因为只有它会让"不能用的判决"看起来完美。

## 10. 能力覆盖率（coverage）

`coverage` 不跑案例、不下判决，只把 manifest 的 `capabilities` 与案例 `reference_trajectory[].capability` 对上账。

三个数必须分开报：

| 字段 | 含义 | 该怎么读 |
| --- | --- | --- |
| `used` | 被至少一条案例用到 | — |
| `unused` | 声明了但没被用到 | 案例还不够狠，不是缺陷 |
| `missing` | 案例要了但 manifest 没声明 | 缺口：这些步只能是 `unknown` |

`rate = used / declared`；`declared` 为 0 时为 `null`（不是 `0`）。

观测域单独报：案例 `observability.declared_scopes` 对 manifest `scopes` 求差，缺的那些集合上的断言只能是 `unknown`。

出口判据：`missing > 0` 不通过；给定 `--min` 时 `rate` 低于门槛也不通过（`rate` 为 `null` 一律视为不达标）。

## 11. 陷阱普查（traps）

`traps` 与 `audit` 是两件不同的事，输入也不同：

| | 输入 | 问的问题 |
|---|---|---|
| `audit` | 两份判决（一个实现当尺子） | 判决器自己漏判了多少 |
| `traps` | 一份判决 + 案例原文 | 这批判决里有多少条是在盲区里产生的 |

### 11.1 四种状态

对每条判决、每个陷阱，给出且只给出一个状态：

| 状态 | 判定条件 |
|---|---|
| `absent` | 案例结构上碰不到这个陷阱 |
| `guarded` | 碰到了，且判决带着可核对的凭据 |
| `blind` | 碰到了，判决却是 `pass` / `fail` |
| `unusable` | 判决本身无效，不参与任何比率。判据是**这一次执行本身不可信**，与产品无关：`infrastructure_error`（环境故障）、`contract_violation`（适配器违约，判定权威不在）、`effect_uncertain`（可能已生效，结果不可知） |

`guarded` 只表示「有据可查」，不表示「安全」：适配器可以谎报。规范不要求验证凭据的真伪，只要求把凭据留下来。

探测器自身抛错时按 `blind` 记录并附原因，不得静默跳过——探测器坏了和风险未覆盖是同一件事。

`unusable` 的判据必须写成**集合**，不能写成「等于 `infrastructure_error`」。每加一个表示「这一次什么都没测成」的理由码，都要同步这个集合——漏掉就会被算进 `blind`，于是把「没测」报成「测了但看不出来」，方向正好相反。反例不能错杀：`missing_observation` 是**真盲区**（看得见接口，看不见内容），必须留在 `blind` 里。

### 11.2 四个陷阱

| id | 涉及条件 | `guarded` 条件 |
|---|---|---|
| `identity-collapse` | 轨迹中出现 ≥2 个不同 `as` | 每一步都有 `evidence.trace[i].identity`，且与 `evidence.role_bindings[as]` 一致 |
| `event-vocabulary` | 任一断言（含 composite 展开）为 `event_absent` | 有 `evidence.environment.events_types` 且事件完整；或已判 `unknown / unsupported_event` |
| `draft-gate` | `draft.status !== 'confirmed'` | 已判 `unknown / unconfirmed_draft` |
| `terminal-only` | 只有终态类断言（`entity_exists` / `field_equals` / `count_delta` / `unchanged`），没有过程类断言（`status_transition` / `event_absent`） | 不适用（碰到即 `blind`） |

新增陷阱属于规范变更，必须同时提供：涉及条件、`guarded` 条件、一个在 `docs/museum/` 里有出处的展品。**没有展品的陷阱不收。**

### 11.3 比率与分母

比率的分母是**涉及到的风险点数**，不是案例数：一局可以同时踩多个坑。

```
blind_rate = Σ blind / Σ (guarded + blind)
```

任何一侧为 0 时 `blind_rate` 为 `null`，打印「—（分母为 0）」，不得显示 `0%`。

`unusable` 的判决不进入分母，另行报出数量：环境故障的判决本来就不该计分。

### 11.4 门槛

默认不设门槛、只报告，退出码 0。给了 `--max-blind=<0..1>` 才在超过时退出码 1；`blind_rate` 为 `null` 一律视为不超限。

不设默认门槛是刻意的：盲区率是结构性指标，一个默认值会让 CI 长期红，最终被参数关掉。

## 12. 判据准入（certify）

### 12.1 要解决的问题

案例里可以写任意多条断言，规范管不住「写了但没用」的断言。判据准入给它一个
机械判据：**去掉它，判决会不会变**。

### 12.2 变异体

变异体 = 正确实现 P⁺ 的一份副本，只在一处被改坏。两层：

| 层 | 改什么 | 用来看 |
| --- | --- | --- |
| `state` | 只篡改 `observe()` 返回的规范视图 | 终态类断言够不够狠 |
| `execute` | 篡改动作的结局（放行本该拒绝的写） | 负例步够不够狠 |

内置十二个（目录见 12.8）。

观测层：`m-money-off-by-cent`、`m-status-frozen`、`m-history-empty`、
`m-extra-foreign-order`、`m-item-count-flattened`、`m-pickup-no-offset`、
`m-total-single-unit`、`m-subtotal-stale`。

执行层：`m-foreign-write-allowed`、`m-no-reject`、`m-cancel-noop`、`m-double-create`。

其中 `m-item-count-flattened` / `m-pickup-no-offset` / `m-total-single-unit` /
`m-subtotal-stale` 在参考案例集上**一个都抓不住**：参考案例只在数量为 1 的订单上
断言过金额。它们留在目录里，是为了让这个盲区一直是可见的。

变异体是**可审的清单**，不是不可见的天命：它只覆盖想到的坏法。

### 12.3 杀手判据

断言 `a` 是变异体 `m` 的杀手，当且仅当：

```
a(P⁺) = true   且   a(m) = false
```

三种非杀手：

| `a(m)` | 结论 | 理由 |
| --- | --- | --- |
| `true` | 抓不住 | 这个坏法它看不见 |
| `unknown` | 说不出话 | 三值纪律下不能给断言记功 |
| `a(P⁺) ≠ true` | 不参与 | 正确实现上就不成立，没有准入资格 |

最后一行有个有用的副作用：故意失败的见证案例（例如 `coffee/foreign-pickup`）里的
断言会被标成 `unarmed`，不会污染统计，也不会被误当成「空转断言」而被建议删掉。

### 12.4 两个层级的杀伤

- **断言级**：`kills` —— 被某条断言抓死。
- **判决级**：变异后判决签名 `(status, reason_code)` 与基准不同 —— 通常是负例步在起作用。

只有判决级杀伤的变异体，不会出现在最小充分集里：它的守卫是步的 `expected_outcome`，
不是断言。报告里显示为 `判决级 ×N`。

### 12.5 最小充分集

对「被断言抓到的变异体」做贪心集合覆盖，得到一份最小断言清单。
`uncovered` 必须为空；非空说明覆盖算法漏了，当作错误看。

### 12.6 退出码

| 情况 | 退出码 |
| --- | --- |
| 有变异体漏网 | 1 |
| 全部抓到 | 0 |
| `--strict` 且存在「能求值但抓不住任何东西」的断言 | 1 |

默认不对空转断言判红：空转是正常的中间状态，一刀切会让人把命令整个关掉。

### 12.9 三档状态与建议断言

漏网的变异体必须再分一档，否则「欠账」和「永远清不掉的账」会混在一起：

| 状态 | 判定条件 | 含义 |
| --- | --- | --- |
| `caught` | 存在断言 `a`：`a(P⁺)=true` 且 `a(m)=false`，或判决签名不同 | 已抓住 |
| `killable` | 任意一条案例上，`final`（或 `initial`）的摊平视图存在叶子差异 | **一定杀得掉**，只是还没写断言 |
| `undetermined` | 所有案例上逐叶子比较均无差异 | 可能等价，也可能案例没走到 |

`killable` 是构造性的：差异本身就是见证。给定差异路径 `p` 与正确值 `v`，
`{kind:"field_equals", selector, path, value:v}` 必然杀死它。

建议断言的生成规则（`suggestFromWitness`）只翻两种形态，翻不出来就返回 null，**不许猜**：

- `orders.length`（数组长度差异）→ `count_delta`，`delta = 正确的终态长度 − 正确实现的初态长度`
- `<col>.<i>.<path>`（集合内实体字段差异）→ `field_equals`，`selector={collection,col,index:i}`

`<col> ∈ {orders, menu, status_log}`（规范视图的三个集合）。落在集合外的差异、
把整个实体换掉的差异、`undefined` 取值，一律不翻。

**每条建议断言必须当场验证**：在 `P⁺` 上求值为 `true`、在 `m` 上求值为 `false`，
才允许出现在报告里（`verifySuggestion`）。没验过的建议等于没给。

`certify --suggest` 按案例分组输出可直接粘进案例的片段。退出码规则不变（有漏网仍为 1）。

### 12.9.1 不可移植字段：给得出建议 ≠ 该给

有一类差异看得见、也杀得掉，但**写不成能跨实现的断言**：

| 字段 | 为什么不可移植 |
| --- | --- |
| `id` / `oid` / `seq` | 库自增或发号器决定，换实现、换一次跑批都变 |
| `createTime` / `updatedAt` / `at` / `timestamp` / 任意 `*At`、`*Time` | 时钟决定 |
| `pickupNo` | 各实现自己的编号约定（咖啡店是 `100+id`，别家不是） |
| `username` / `by` / `operatorName` | 复位方式决定（咖啡店每轮注册新账号） |

`suggestFromWitness` 对这些字段一律返回 `null`（`isPortablePath`）。理由不是保守：
把它们建议成 `field_equals`，写进去的人会得到一个**跨实现必红**的检查项 ——
比不给建议更糟，因为它长得像一条建议。

给不出建议时不许沉默：该变异体标 `suggestionBlocked: true`，`--suggest` 末尾点名，
准入基线把它单列成「不可移植」而不是「缺模板」。沉默会被读成「工具没找到洞」。

### 12.9.2 为什么 certify 是串行的

`certify` 刻意不提供并发开关。实测过：真实后端上 12 变异体 × 8 案例，串行 77 秒，
6 并发 8 秒 —— 但**结论漂移了**：同一个变异体在并发下从「被 `happy-path#goal[4]` 抓住」
变成「判决级 ×3」，还有变异体从欠账变成漏网。串行连跑两次则逐字相同。

原因不难理解：并发把「同一台机器上的时序」放进了被测系统，而跨实现对照的全部价值
就在于两边跑的是同一件事。快 9 倍但答案会变的评估器，比慢的那个更没用。

### 12.8 变异体目录的格式

变异体不放代码里，放目录里：`docs/mutants/`。一个文件一个变异体，文件名即 id。

```js
// docs/mutants/m-some-thing.mjs
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-some-thing',      // 必须与文件名一致
  title: '一句话名字',
  layer: 'state',          // state | execute
  symptom: '用户投诉长什么样',
  mechanism: '具体改了什么',
  catch_hint: '什么样的断言能抓住它；什么样的抓不住',
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => { /* 只改这里 */ });
}
```

| 字段 | 必需 | 约束 |
| --- | --- | --- |
| `id` | 是 | `^m-[a-z0-9]+(-[a-z0-9]+)*$`，且必须等于文件名（去扩展名） |
| `title` | 是 | 非空 |
| `layer` | 是 | `state` 或 `execute` |
| `symptom` | 是 | 非空。写不出用户会怎么投诉，说明这个变异体不对应真故障 |
| `mechanism` | 是 | 非空。改了什么，一句话 |
| `catch_hint` | 是 | 非空。抓得住的与抓不住的都要写 |
| `wrap(adapter)` | 是 | 返回同契约的适配器 |

`docs/mutants/index.mjs` 的 `validateMutants()` 在加载时校验上表，任何一条不满足就抛错
（CI 因此会失败）。**这不只是防手滑：它拦的是"复制上一个变异体、只改了里面的逻辑、忘了改 id"**
——两个 id 不同的同一变异体，等于把一张票投了两遍，会把最小充分集算得更小、更好看。

三个包装器（`docs/mutants/_helpers.mjs`），不要去动适配器内部状态：

| 包装器 | 改什么 |
| --- | --- |
| `wrapState(adapter, fn)` | `observe()` 的返回值 |
| `wrapExecute(adapter, fn)` | 执行前的请求（换身份、换参数） |
| `wrapExecuteAfter(adapter, fn)` | 执行后的结局（该拒的改成成功） |

它们是适配器的**装饰器**，不是变体机制：`certify` 不关心变异体怎么实现，只关心
`observe`/`execute` 的行为与正确实现不同（12.3）。

新增变异体的验收标准不属于格式，属于评审：见 `docs/mutants/README.md` 的四条收稿标准。

### 12.7 为什么单独一条命令

`audit` 需要两个独立实现才知道真假；`certify` 只需要一个正确实现加一组坏法。
在没有第二个实现的场合（别人的系统、只有一个后端的产品），`certify` 仍然可用。

**建议可能是位置相关的。** 走 `orders.0.totalAmount` 这种路径的建议，抓到的是「第 0 行」，
换一个实现行序变了就红。它不是错的 —— 现有案例里也用 index —— 但它比 `where` 过滤脆。
看到 index 的建议，优先想想能不能换成 `unique` / `subset` 这类断结构的写法。

### 12.10 快路径：state 层变异体为什么不重放

certify 对每个变异体本来要跑一遍完整轨迹。真实后端上这是全部耗时所在，而 22 个变异体里有 14 个是 state 层——它们只包 `observe()`，不碰 `execute()`。

对这类变异体，重放是不必要的。它的 `wrap` 把 tamper 函数挂在 `_agentWebStateFn` 上，certify 直接拿正确实现的 ctx 变换一份：

| 变异体 | 执行结局 | ctx 从哪来 |
|---|---|---|
| state 层 | 与正确实现逐项相同 | `transformCtx(base.ctx, tamper)` |
| execute 层 | 可能不同 | 必须真重放 |

**等价性**：变异体重放时第 i 次 `observe` 返回 `tamper(clone(s_i))`，`s_i` 是正确实现第 i 次 `observe` 的返回值；`wrapState` 只包 `observe`，内部执行逻辑与正确实现相同 ⇒ 观察到的序列逐项相同 ⇒ tamper 的输入相同、输出相同。**前提是 tamper 为纯函数**，这也是变异体目录第 1 条要求（只坏一处、不留隐藏状态）的原因。

**唯一例外**：正确实现判成 `unknown/missing_observation` 时退回重放。这条 reason 在判决顺序表里出现两次（第 4 条在执行期、第 16 条在断言期），只凭代码分不出是哪一条；第 16 条排在 `assertion_false` 之后，意味着断言变假时真判决会翻成 fail，快路径推不出来。这类案例很少，退回重放不影响整体。

`scripts/state-equivalence.mjs` 是这条优化的凭据：逐案例 × 逐 state 变异体对比两条路径的断言结果、判决签名、初态与终态视图，任何一格不同退出 1。CI 在跑。

**测量**（咖啡店真实后端，3 条案例）：快路径 15.1s，`AGENT_WEB_CERTIFY_SLOW=1` 强制重放 44.5s，**2.95×**；memory 域两者都是二十几毫秒，没有可测差异（没有网络往返可省）。

### 12.11 漂移不是见证

certify 判断「这个变异体被案例看见了」靠比对两份规范视图。但同一条案例跑两遍，视图本来就不一样：自增 id、时间戳、取餐号、操作人。

所以每条案例先把正确实现跑两遍，两次之间的差异路径记成漂移集，再从所有见证里剔除。不剔的后果是实测出来的——真实后端上 `m-duplicate-row` 拿到的见证是：

```json
{"path":"orders.0.id","correct":196,"mutant":210}
```

它「看见」的是订单号从 196 长到 210，而不是那个变异体把最后一行复制成了第一行。更糟的是这条见证会继续变成建议断言 `orders.0.id == 196`，换个实现必红——正是 `k-unportable-assertion` 里记的那个坑。

剔除之后，快路径与重放在真实后端上判定完全一致（3 条案例 0 处差异）；memory 域不受影响，确定性实现的漂移集为空。

## 13. 出题与批改（drill）

第 12 章回答"这条断言该不该被收下"。这一章回答一个不同的问题：
**能不能把变异体变成题，把断言变成答案，让对错由机制判定。**

动机很实际：训练与评测都需要标签，而标签不能由模型打。一条断言够不够狠，
跑一遍就知道（12.3 的杀手判据），所以标签可以完全由机制产出。

### 13.1 出题的前置条件

一个「(案例 C, 变异体 m)」配对能出题，必须同时满足三条：

1. **C 在正确实现 P⁺ 上判 `pass`。** 见证型案例（故意失败、故意无法判断）本来就不该 pass，
   拿它出题等于要求断言"抓住"一个它本来就要拒绝的东西。
2. **C 在 m(P⁺) 上也是 `pass`。** 判决不同说明这套断言已经看出区别了，答案已经写在案例里。
3. **m 改动了 C 能观测到的东西。** 判据是 `{initial, final, events}` 的规范化字符串是否相同；
   相同意味着这份实现的变化在 C 的视野之外，没有任何断言能抓住一个观测里不存在的差异。
   这是案例的边界，不是缺陷。

不满足第 1 条的配对记 `not_applicable`，不满足第 2 条记 `skipped`，不满足第 3 条记 `invisible`，
三条都满足的进 `asked`。四个数相加必须等于 `cases × mutants`。

**出题数不是漏洞数。** 规范要求把这四个桶分开报，禁止只报 `asked`。

### 13.2 题面

每题两个文件：`<id>.json`（完整题目，含答案）与 `<id>.task.md`（题面）。

题面**可以**包含：案例 id、轨迹步数、这份实现仍然判 pass 的事实、`symptom`、`mechanism`、
案例现有的断言列表、判分规则。

题面**不得**包含：`catch_hint`、变异体 id、`answer` 的任何字段。
题面给人的是"这里坏了，你写条断言抓住它"，不是"答案是这样"。

### 13.3 判分

批改不读提交的说明文字，只把提交的断言放到两个实现上各跑一遍：

| 在 P⁺ 上 | 在 m(P⁺) 上 | 判定 |
| --- | --- | --- |
| 不成立 | — | `unarmed`（废断言） |
| 成立 | 假 | `killed`（抓到了） |
| 成立 | 不确定 | `blind` |
| 成立 | 真 | `survived`（看不见） |

一题至少一条 `killed` 才算 `solved`。提交层面另有四态：`invalid`（不过
`validateAssertions`）、`empty`（空数组）、`unanswered`（没交）、`unknown_mutant`。
这四态**不进分母**，单独报数。

`rate = solved / (solved + missed)`；分母为 0 时 `rate` 必须是 `null`，不得为 `0`。

### 13.4 退出码

| 参数 | 通过条件 |
| --- | --- |
| 无 `--min` | `missed === 0` 且 `ungraded === 0`（全解出，且没有批改不了的题） |
| `--allow-missed` | `missed === 0` 且 `invalid/empty/unknown_mutant` 全为 0（**没答的照实报，答错与交不上来的算失败**） |
| `--min=X` | `rate !== null` 且 `rate >= X` |

`rate` 为 `null` 时一律不算通过 —— 一道题都没批改，不能算 100%。

`--allow-missed` 是给示例提交和 CI 用的：建议断言只能表达「集合内某个字段的取值差」，
整实体替换与集合外差异表达不了，所以仓库里那份 `examples/drills/good` 只能覆盖 22 道题里的 11 道。
用 `--allow-missed` 校验的是「答了就必须对」，默认那条校验的是「必须答满」——两个都要留着，
前者防瞎写，后者防偷懒。

### 13.5 不许做的事

- 不许引入"由模型判断断言够不够狠"。判分只认 `killed`，不认解释。
- 不许把 `unarmed` 当作 `killed`。在正确实现上就不成立的断言，对任何实现都没有区别力。
- 不许为了让分数好看而剔除 `missed` 的题。题的集合由 13.1 的三条决定，不由成绩决定。

### 13.6 台账与统计

`drill grade --record[=FILE]` 把这次批改追加进台账（默认 `.agent-web/drills.jsonl`）。
台账是**只追加**的：任何一次批改都不改写历史。

**一条记录存什么**

| 字段 | 内容 | 为什么 |
| --- | --- | --- |
| `item` | `case@mutant` | 题号固定，跨批次才能对齐 |
| `status` | `solved` / `missed` / `unanswered` / `empty` / `invalid` / `unknown_mutant` | 与 13.3 一致 |
| `cells` | 每条断言的 `killed` / `survived` / `blind` / `unarmed` | 这是能算难度和被识别度的最小信息 |
| `submission` | 提交指纹 | 对**批改结果的形状**取 sha256，不是对提交文本取哈希 |

**不存什么**：提交的断言内容、`detail` 文案、任何一行答案。台账是用来算难度的，
不是用来收集答案的——收集答案会把「出题」变成「泄题」。

**`drill stats`**

- 总解出率带 **Wilson 95% 区间**。11/11 是 `100.0% [74.1%, 100.0%]`，不是「100%」。
- 每题 **至少 5 次批改**才分层（`easy` ≥ 0.8 / `medium` ≥ 0.4 / `hard` < 0.4），
  不够就记 `insufficient_data`，不给百分比结论。
- 默认只算能批改的批次；`unanswered` 等不进分母（`--include-ungraded` 可看）。
- 退出码：不给 `--min-attempts` 恒 0；给了就要求总尝试数达到它。

**`drill --order=empirical`**：按台账里的经验难度出题，难的在前，没测过的排在最后。
没有台账时退回原顺序，不静默假装排过。

**为什么不自动调难度**：难度是别人答出来的，不是我们算出来的。台账只记录，
不改题面、不改变异体、不改断言——题目难度应当由题本身决定。

## 14. 探针（probe）

前面所有命令都建立在一个前提上：**适配器给的观测是真的**。这个前提此前从未被检查过。

一份撒谎的适配器不会报错，它只是安静地准：判决是真的判决，只是测的不是你以为的东西。
所以：**换成新适配器，先跑探针，再谈判决。**

### 14.1 查什么

| # | 检查 | 判据 | 失败意味着 |
| --- | --- | --- | --- |
| 1 | 契约 | 五方法齐全 | 适配器没写完 |
| 2 | manifest | `manifest()` 可读且通过 `validateManifest` | 声明写错了，后面全部白跑 |
| 3 | 复位幂等 | 连续两次 `reset` 后的初始视图指纹相同 | 复位没落实到可观测状态上 |
| 4 | 观测稳定 | 同一状态连读两次指纹相同 | 视图里混进时钟或随机数，`count_delta` 会随机漂移 |
| 5 | 无状态泄漏 | 写一轮再 `reset`，仍等于第一份初态 | 上一轮的残留会流进下一轮，判决之间不再独立 |
| 6 | 空参不炸 | 每条能力用空参数调一次，不得抛异常、不得 `infra_error` | 参数校验没做，Agent 一乱调就崩 |
| 7 | 声明了的能力真的存在 | manifest 里每条能力调一次，不得回 `unsupported` | 声明与实现脱节，案例会在这一步静默变成覆盖缺口 |
| 8 | 角色真的生效 | 每条有角色约束的写能力，换一个局外人去调，必须被拒 | 身份塌缩：适配器忽略了 `as`，越权案例会假通过 |
| 9 | 读操作不改状态 | 参数全可选的读能力，执行后视图指纹不变 | 读偷偷写了东西，`count_delta` 会莫名其妙地漂 |
| 10 | 契约内的 outcome | 每次 `execute` 的 `outcome` 必须在 `OUTCOMES` 里 | 枚举外的值会让那一步滑到终态断言假通过（见 `docs/museum/e07`） |
| 11 | `close` 幂等 | 连续两次 `close` 都不抛错 | 清理函数逼调用方自己记账，而记账处通常是重试路径 |
| — | 写了要变 | 声明 `applied` 的写操作之后视图毫无变化 → **只报警** | 可能是假执行，也可能这个写本来就不改规范视图 |

最后一条只报警不判死，是刻意的：发通知、写审计日志这类写操作本来就不改视图，替人判死会制造误报。
探针给的是「这几件可机械判定的事上没有矛盾」，不是「这个适配器可信」。

第 7–9 项是 v0.47.0 补的，第 10 项 v0.60.0，第 11 项 v0.61.0。每一条都对应一次真实的假通过：
第 8 项对应 labaccess 适配器忽略 `action.as` 让越权案例转绿；第 10 项对应四个分类分支都不命中时
那一步既不失败也不算未知，一路滑到终态断言。

### 14.2 探针查不了的

- 裁剪过的 `observe`：整个字段不返回，探针只能看见「稳定但残缺」，无法知道缺了什么
- 语义错误的映射：字段名对了、含义错了 —— 这要靠 `compare` 跨实现对照
- 只在特定参数下撒谎 —— 探针只用空参数调用各一次

### 14.3 用法与退出码

```
agent-web probe --adapter=SPEC [--detail] [--json] [--timeout=MS] [--allow-volatile]
```

全部通过退出 0；任何一项 fail 退出 1；warn 不影响退出码。
`--allow-volatile` 跳过「观测稳定」这一项，只给视图本身合法地含时钟的适配器用 ——
跳过就要在文档里写清原因，否则下一个人不知道这个洞是开着的。

## 15. 从一个网址开始（discover）

前面的章节都假定你已经写好了一个适配器。这一章说的是：**先不写，先看看这台站点有什么。**

### 15.1 它能给什么，不能给什么

| | |
|---|---|
| 能给 | 这台站点现在有哪些接口、哪些真的响应、响应是不是 JSON、是不是数组 |
| 能给 | 一个立刻能跑的**只读**适配器，以及一批只读案例草稿 |
| 能给（`--writes`） | create 类接口的**往返**案例：写完之后那个集合确实多了一条 |
| 不能给 | 「这个业务的写操作应该保证什么」 |
| 不能给 | 登录流程、字段语义、断言里的具体数值 |

第二行是关键：生成的东西不需要人补就能跑。第三行是关键的反面——能跑不等于测对了。

写操作猜不出来，是因为它要求知道业务。看到 `POST /orders` 能知道「会创建一个订单」，
但推不出「同一个人对同一个订单重复下单该不该被拒」。前一句写在接口描述里，后一句是产品决策。
**猜出来的断言不许入库**，这是第 12 章判据准入的同一条规矩。

### 15.2 探测顺序

1. `GET /` —— 站点通不通、根路径返回什么类型、有没有 title
2. 逐个试 `OPENAPI_CANDIDATES` 里的常见位置（`/openapi.json`、`/v3/api-docs`、`/swagger.json` 等 8 个）
3. 找到 OpenAPI 就只认它的 `paths`，不猜 schema 语义
4. 找不到就停在「没有机器可读的接口描述」，不生成任何文件

第 4 步不做「猜常见路径」这件事。猜出来的 404 会变成案例里的假失败，
而假失败比缺案例更坏 —— 它让人开始不信任这套工具。

### 15.3 能力 id 的推导规则

| 方法 | 路径 | id |
|---|---|---|
| GET | `/api/orders` | `orders.list` |
| GET | `/api/orders/{id}` | `orders.get` |
| POST | `/api/orders` | `orders.create` |
| PUT/PATCH | `/api/orders/{id}` | `orders.update` |
| DELETE | `/api/orders/{id}` | `orders.delete` |
| POST | `/api/menu/{id}/image` | `menu.image` |

最后一行是特例，也是必须的：只看动词的话，`POST /menu/{id}/image` 会变成 `menu.create`，
和「新建菜单」撞名，一条断言会同时命中两个意图。

资源名取路径里第一个不是占位符、也不在 `api/rest/v1..v4/public/internal` 名单里的段。

### 15.4 生成的适配器

- `reset_strategy` 一律 `identity` —— 只读适配器不写，也就不需要复位
- `observe()` 按每个资源的无参 GET 拉一次，把结果放进 `state[资源名]`
- `execute()` 对读能力返回 `applied`，对**所有**写能力返回 `unsupported`
- 每个能力的 `evidence_level` 都是 `inferred`

第三条是本项目一贯的区分：`unsupported` 是「适配器演不了」，`rejected` 是「应用拒绝了」。
把前者记成后者，会让覆盖不足被算成业务规则（见第 6 章开头）。

### 15.5 生成的案例

每个资源一条，断言只有一条：

```json
{ "kind": "unchanged", "scopes": ["orders"] }
```

读操作不该改变任何东西。这是一条**真断言**：它抓得住「GET 顺手往主表写了个访问计数」
「列表接口偷偷做了 lazy migration」这类故障。它也是**弱断言**：抓不住任何业务错误。

所以生成的案例一律是草稿（第 5.8 节），必须有人确认才出判决。
``--accept=<名字>` 可以跳过这一步，但那个名字会写进案例 —— 跳过确认这件事本身要留痕。

### 15.6 带路径参数的接口不实跑

`/api/orders/{id}` 这种路径拿不到真实 id。拼一个 `/api/orders/{id}` 去打，服务器会回 404，
报告里就多一条假失败。

规则：**带参数的接口标记 `skipped: 需要路径参数`，不打。** 报告里单独计数，不算进「可用/不可用」的分母。

### 15.8 `--writes`：只推「往返」，不推业务

写操作里唯一能机械推出来的是**往返语义**：发一个 create，然后看那个集合是不是多了一条。

| 方法 | 路径 | 做什么 |
|---|---|---|
| POST | `/api/orders` | 生成 `orders.create` 的往返案例 |
| DELETE | `/api/orders/{id}` | **不生成** —— 得先有一条真实实体，探测阶段拿不到 id |
| PUT/PATCH | `/api/orders/{id}` | **不生成** —— 同上，而且要判断「改成了什么」需要业务知识 |

请求体从 OpenAPI 的 `requestBody` schema 造：字符串填 `x`、数字填 `minimum` 或 1、
枚举取第一个、数组取一个元素、`$ref` 顺着 `components.schemas` 解开，解不开就返回 `null`
（**不编一个假的请求体**）。造出来的只是「形状对」，不是「内容对」——它的作用是不让服务器
因为类型错误拒收我们，从而把一次真实的写操作跑完。

案例只有一条断言：

```json
{ "kind": "count_delta", "selector": { "collection": "orders" }, "delta": 1 }
```

它断的是「多了一条」，不是「多出来的那条内容对不对」。后者要业务知识，见 15.1。

`delete` / `update` 没生成的接口会列进 `report.writeTodo` 并写明原因（`需要先有一条真实实体`
或 `不是 create，语义要人给`），不是默默略过。

实测（同一批生成物，两个实现）：写入了的判 `pass`；回了 200 但什么都没写的判
`fail / assertion_false`，理由 `orders 变化 0（期望 1）`。这就是这个功能的意义——
它能抓到「接口假装成功」。

### 15.7 退出码

| 码 | 含义 |
|---|---|
| 0 | 找到接口，生成的只读接口全部可用 |
| 1 | 站点通但没找到接口描述；或找到了但有只读接口不可用 |
| 2 | 站点连不上，或用法错误 |

---

## 16. 事故档案（knowledge / recall）

前面各章管的是「这次判得对不对」。这一章管的是「上次错过的地方，这次有没有再错一遍」。

### 15.1 入库宪法

一条错误要进 `knowledge/`，必须同时具备两样东西：

| 要件 | 含义 | 缺失的后果 |
| --- | --- | --- |
| `repro` | 一条能跑的命令，证明它真的发生过 | 变成传闻，下一个人无法确认 |
| `guard` | 一个已经落地的检查项（`probe` / `certify` / `ci` / `test` / `lint`） | 变成日志，下次发生时没有人喊 |

`guard.kind` 为 `none` 的条目**不被接受**，`validateEntry` 直接报「不许入库」。这一条和判据准入是同一句话的两面：
那边要求「杀不掉任何变异体的断言不许入库」，这边要求「给不出判据的错误不许入库」。

### 15.2 条目字段

```js
export const eNN = {
  id: 'k-some-thing',          // 必须 kebab-case 且以 k- 开头，与文件名一致
  title: '一句话说清坏在哪',
  symptom: '看到的现象',
  cause: '根因，写到能据此改代码的程度',
  fix: '当时怎么修的',
  fingerprint: {
    structure: '层/环节:失败类别',   // 例如 execute/binding:unexpected_pass
    witness: 'orders.*.pickupNo',    // 见证路径，支持 * 与 (a|b|*At)
    detector: 'certify:m-xxx',       // 能被扫出来的检测项 id
  },
  first_seen: { commit: 'abc1234', date: '2026-11-04', evidence: '哪份文档/哪个数字能对上' },
  guard: { kind: 'test', ref: '哪个文件里的哪条检查' },
  repro: '一条真的能跑的命令',
  recurred: 0,
};
```

### 15.3 指纹的三层

| 层 | 用来区分什么 | 例 |
| --- | --- | --- |
| `structure` | 坏在哪一环、哪一类 | `execute/binding:unexpected_pass` |
| `witness` | 坏在哪个字段 | `orders.*.pickupNo` |
| `detector` | 哪个检查项认得出它 | `certify:m-pickup-no-offset` |

默认要求 `detector` 完全一致才命中。「总价算错」和「取餐号算错」结构相同、见证不同，是两条记录，不合并。
`--loose` 才退到 `witness` 通配匹配，用于检测项改名之后的老档案。

### 15.4 「加深记忆」是可验证的动作

命中次数记在 `.agent-web/recall.json`（不进版本库）：

| 第几次命中 | 行为 | 退出码 |
| --- | --- | --- |
| 1 | 提示，附当时怎么修的和判据落在哪 | 0 |
| ≥2 | 提示 + 拦下 | 1（`--no-gate` 放过） |

次数是记的，不是算的；拦截是显式的，不是隐式的。这样「它记得这件事」和「它这次拦了你」都能被单独验证。

### 15.5 哪些档案不靠 recall 守

`recall` 只扫 `certify:` / `probe:` / `traps:` 三类前缀。`test:` / `ci:` / `lint:` 条目由 CI 或单测兜底，
`recall` 会单列出来并写明各自的落点，避免「没被扫到」被读成「没人管」。

## 17. 变异体生成（breed）

手写的变异体是「我们想得到的」。想得到的总会用完，所以第二个来源是**形状**：
观测到的字段有哪些、类型是什么，就照着这些位置造故障。

### 17.1 它看哪里

只走规范视图里已经公开的集合，默认 `orders` 与 `menu`：

| 位置 | 算子 |
| --- | --- |
| 数值叶子 | `off-by-one`（+1）、`double`（×2）、`cent`（÷100） |
| 文本叶子 | `prefix`（加 `zz_`）、`upper`（转大写）、`blank`（置空） |
| 集合本身 | `drop-last`（丢最后一个）、`reverse`（逆序） |

`status_log` 默认排除：它是内部流水，对它的字段逐条断言属于过度规定，造出来的故障能杀但不值得杀。

`isPortablePath` 先过一遍，`id` / `createTime` / `pickupNo` / `username` 这类**不造**——
它们的值由实现或时钟决定，在这里造出来的故障只能靠不可移植的断言抓。

### 17.2 恒等算子不生成

`'MAKING'.toUpperCase()` 还是 `'MAKING'`，`'拿铁'` 根本没有大小写，`56 / 100` 之后才是 0.56。
一个「改了等于没改」的变异体不是资产，它只会把 `undetermined` 撑大、让基线看起来更差。

生成前用值算一遍，恒等的直接计入 `skipped_noop` 报出来。**跳过也要报**——不说的话，
读的人会以为这个位置没被覆盖。

### 17.3 生成不等于入库

`breed` 只负责产。能不能留下由 `certify --mutants-dir=<目录>` 判，判据和手写的一模一样：
杀不掉任何断言的一律 `undetermined`。

```bash
node bin/agent-web.mjs breed --adapter=memory --from-case=cases/coffee/happy-path.json --out=.tmp-bred
node bin/agent-web.mjs certify cases/coffee --adapter=memory --mutants-dir=.tmp-bred
```

`--from-case` 会先把那条案例跑一遍，拿**终态**当形状来源。不给的话只看得到菜单这类静态表——
订单是跑出来的，不跑就没有。

生成的目录是**一次性产物**，不要提交：它属于某一次观测，换一条案例形状就变了。

### 17.4 生成之后一定会遇到的两类「杀得掉但抓不到」

- **不可移植字段**：`m-pickup-no-offset` 是典型。观测层看得见 `pickupNo` 从 1101 变成 1001，
  但偏移 100 是各实现自己的约定，写进跨实现案例就会在另一个实现上假红。
- **没有约定顺序的集合**：`reverse` 造出的故障看得见，但集合本来就没规定顺序，
  没有一条断言该表达它。这类不该记成欠账，该记成「不打算管」。

这两类都不是缺陷，是判据准入在提醒你：**能被观测到**不等于**值得被断言**。

### 17.5 退出码

`0` 有产出；`1` 观测不到状态（没东西可造）；`2` 用法错。

---

## 18. 录一段流量（tap / learn / decl / twin）

前十七章都在讲「怎么判」，这一章讲「第一个适配器从哪来」。

discover（第十五章）只解决只读接口。写操作此前必须人写，因为机器不知道业务该保证什么。
tap 换了问法：**不猜业务规则，只问「应用刚才答应过什么」**。

### 18.1 tap：录状态，不录动作

`agent-web tap --target=URL [--port=8080] [--out=DIR] [--seconds=N]`

反向代理，把真实操作的请求与响应原样录进 `DIR/traffic.jsonl`。行业同类工具录下来的是**动作脚本**，
我们录下来的是**状态**，这是后面能长出孪生与判决的原因。

红线两条，tap 启动时会打印：
1. 流量会真的打到目标。对生产库录写操作，是你自己的选择。
2. 鉴权头、cookie、正文里的口令与 token **不落盘**，换成稳定伪名：同一个值始终换同一个名字（`password#1`、`bearer#2`）。

伪名是为了案例可公开：录制文件进入别人手里，也不含你的凭据。

### 18.2 learn：四样东西

`agent-web learn <traffic.jsonl> --out=DIR [--name=] [--accept=名字]`

| 产物 | 是什么 | 能不能不要 |
| --- | --- | --- |
| `adapter.yml` | 声明式适配器：登录、能力、视图投影、状态码归类 | 不能，判决要用 |
| `twin.json` | 回放孪生：初态 + 每步的状态差 | 能，但它是白送的第二个实现 |
| `cases/*.json` | 案例草稿，断言只有从观测直接算得出来的那些 | 不能，没有案例就没有判决 |
| `unclassified.jsonl` | 认不出的形状 | 不能，这是「我有多不懂这台站点」的账 |

三件事必须一起说清楚：

- **一律 `evidence: inferred`**。录出来的东西是「我看到过」，不是「我知道」。判据准入与覆盖率都按 inferred 计。
- **案例默认草稿**（`draft.status: 'unconfirmed'`）。不 `accept` 就不出判决——否则机器观测会冒充成人的期望。
- **登录步不进孪生也不进案例**。鉴权是适配器的职责（`auth` 段），案例只该描述业务动作。录制里登录已被脱敏成伪名，回放时拿伪名当口令必然失败。

### 18.3 声明式适配器（decl）

一份 yaml，不写代码：

```yaml
adapter: todo
base_url:
  value: http://127.0.0.1:8199      # 或者 { env: TODO_BASE_URL }
roles: [dev]
auth:
  login: POST /login
  user_field: username
  pass_field: password
  token: $.token
  accounts:
    dev: { user: dev, pass: "${TODO_PASSWORD}" }
capabilities:
  tasks.create:
    POST: /api/tasks
    as: [dev]
    args: { title: $.title }
view:
  tasks:
    from: GET /api/tasks
    fields: { id: $.id, title: $.title, done: $.done }
```

三条红线：

1. **`base_url` 只许 `{env:名}` 或 `{value:loopback}`**。写死一个公网地址的适配器会被拒载——这个工具有可能被拿去做别人系统上的写操作，地址必须是外部给的。
2. **集合包裹要么显式 `path`，要么自动识别**。`{items:[…]}` / `{data:[…]}` / `{results:[…]}` / `{list:[…]}` 会被认出来；认不出来就按单行处理，并在 `missingScopes` 里说清楚。
3. **状态码归类默认按 2xx/4xx/5xx 分档，`errors` 表可逐码改写**。默认的 404 是「拒绝」，不是「没这个能力」——把「没这个接口」说成「拒绝了」会让覆盖率虚高。

### 18.4 回放孪生（twin）

孪生是「这台应用在某段时间里答应过什么」的可执行副本：初态 + 每步的状态差。它按录制顺序回放，三条拒绝规则：

- `out_of_order`：要执行的能力与录制里的下一步不符
- `args_mismatch`：能力对上了，参数对不上
- `twin_exhausted`：录制里没有下一步了

**它不会装作成功。** 这是它和 mock 的区别：mock 你写什么就是什么，孪生只承认发生过的事。

用处是 `compare`：同一批案例同时打真实系统与孪生，判决必须一致。一致说明案例没有依赖真实系统里的具体编号；不一致的地方，要么案例写死了值，要么孪生没录全。

### 18.5 它明确不做的事

1. **不猜业务规则**。录到「下单成功」不等于知道「库存不足该拒绝」。生成的断言只有从观测直接算得出来的（净计数变化、未改动的集合），其余列成待办。
2. **不重放没录到的路径**。没走过的分支是 `unknown`，不是 `pass`。
3. **不支持多角色链路**。`learn` 只认一个账号；录到管理员才做得成的删除，回放会 403。要支持得按 per-token 伪名反查会话，未做。
4. **伪名不是脱敏的替代品**。正文里用户自己填进去的敏感内容（手机号、地址）不在脱敏范围内——录制文件仍然是内部资料。

### 18.6 验收标准

这一章的功能按四条验收，缺一条不算做完：

1. 陌生 CRUD 应用十分钟内出第一条 `pass`，且不写代码。
2. 同一个案例打真实系统与孪生，`compare` 一致率 100%、视图契约逐字相同。
3. 把应用改坏、**不重录**，必须红在对应断言上。
4. 生成的产物里 grep 不到录制时的口令与 token 原值。

第 3 条是关键：它证明案例抓的是**应用的行为**，不是录制的文本。

## 19. 字段映射（align）

`agent-web align <参照视图.json> <目标视图.json> [--out=align.yml]`：输入两份规范视图
（`{集合名: 行数组}`），输出**建议**映射。它是提议，不是断言——`accepted` 段是空的，
人签之后才算生效。

### 19.1 五路信号

| 信号 | 取值 | 说明 |
| --- | --- | --- |
| 名字 | 0 / 0.6 / 0.8 / 1.0 | 归一（camel/snake/kebab）+ 复数归一到同义词组；**只有四档，没有连续调参空间** |
| 逐行取值 | 0–1 | 同一位置取值相同 |
| 取值多重集 | 0–1 | 行被打乱时位置对不上，值还在 |
| 枚举重合 | 0–1 | 两边都 ≤ 20 个不同取值时算 Jaccard |
| 基数 | 0 / 0.5 / 1 | 都是唯一、或都不是唯一 |

权重 `0.30 名字 + 0.40 取值 + 0.10 枚举 + 0.10 基数 + 0.10 类型`；**类型不同直接出局**
（不做「字符串数字也算数」的宽容，那会把 `id` 和 `status` 配到一起）。

### 19.2 什么算高置信

`score ≥ 0.75` **且**有独立证据：名字至少 0.8，或逐行取值完全一致。
只有枚举重合、只有基数相同，都不够——那两个信号在同一个系统里到处都是。

低于 0.45 不进候选；0.45–0.75 进 `unresolved` 并给 top-3。

### 19.3 集合级硬证据

两份集合的所有叶子值**多重集逐字相同**时，直接给 0.95（Why：「改名级重构」的典型特征——
值一个没变，键全换了）。这条是集合匹配的主证据，字段匹配仍然逐字段重算。

叶子摊平意味着**键名不参与比较**：`{dishName:'拿铁',count:2}` 与 `{label:'拿铁',qty:2}`
摊平后完全一样。

### 19.4 输出

```yaml
align_version: agent-web/align-1
collections:
  - ref: orders
    target: tickets
    confidence: 0.95
mapping:
  - collection: orders
    field: totalAmount
    target_collection: tickets
    target_field: sum
    confidence: 0.94
unresolved:
  - collection: orders
    field: pickupNo
    reason: "最高分低于阈值，需要人签"
accepted: []
```

### 19.5 已知边界

- **嵌套数组只映射容器**：`items → lines` 会配上，但 `count → qty` 要等下钻（本轮不做）。
- **行序无关，列序有关**：多重集信号救得了打乱的行，救不了「同一个字段在不同集合里语义不同」。
- `--require-all` / `--max-unresolved=N` 可以把「说不清」变成失败，默认不拦——
  默认拦会逼人去凑数，那正好是这套东西想避免的。

## 20. 版本演进

`0.1` 之后允许的改动：

- 新增断言 kind（向后兼容）
- 新增 manifest 字段（必须可选）
- 新增 `evidence_level` 取值
- 新增陷阱探测器（见第 11 章），但必须同时给出涉及条件、`guarded` 条件，以及一个在 `docs/museum/` 里有出处的展品
- 新增变异体（见 12.8），但必须填满 `symptom` / `mechanism` / `catch_hint`，且不得与现有变异体只差一个 id

不允许的改动：

- 改判决顺序表
- 改相位表
- 给 `unknown` 换语义
- 让 `traps` 在没有展品的情况下新增陷阱
- 引入任何形式的模型判定
- 让 `drill` 只报 `asked` 而不报 `skipped` / `not_applicable` / `invisible`（四桶必须相加等于配对数）
- 允许 `drill grade` 用提交里的文字说明代替实跑结果

## 25. 交叉复核（crosscheck）

`probe` 查的是「适配器自己说的对不对」。但适配器知道自己被探测，所以它骗得过探针。
`crosscheck` 换一个问法：**同一时刻，两个通道看到的东西一样吗？**

### 25.1 独立通道是什么

不经过适配器自己的 `fetch`，用 `globalThis.fetch` 直连 `manifest.baseUrl` + 能力声明的
HTTP 路径，再比两边响应的指纹。

**它挡的是「适配器在返回体里做手脚」，挡不住「适配器把整个 `globalThis.fetch` 换掉」。**
这条边界写在 LIMITS 里，不改口。

### 25.2 指纹：只比形状与关键值

每次都变的字段必须剔掉，否则正确实现也会判 `divergent`，检测器就成了噪声源：

```
at, time, timestamp, createdAt, updatedAt, createTime, updateTime,
id, key, token, nonce, requestId, traceId, etag, date
```

键顺序不影响（稳定序列化）；数组顺序与长度影响（顺序是数据的一部分，砍掉一条是最常见的谎）。

### 25.3 三类结论与退出码

| 结论 | 触发 | 退出码 |
|---|---|---|
| `consistent` | 两边指纹相同 | 0（仅当全部一致且至少一条） |
| `divergent` | 指纹不同 | 1 |
| `uncheckable` | 不走 HTTP / 没声明路径 / 连不上 / 有一个通道没响应 | 2 |

**「连不上」记 `uncheckable` 不记 `divergent`**：分不清「说谎」与「网络不通」时，
宁可说查不了，也不冤枉实现。

**`uncheckable` 不进分母。** 一条都查不了时 `rate` 是 `null`，不是 `0`——
「没有证据」和「0% 一致」是两件事。

### 25.4 只复核只读、无参的能力

写能力会改状态，两个通道顺序调用必然不同；需要参数的读能力，独立通道不知道该填什么
（适配器可能会填它自己编的值）。所以 `pickReadCapabilities` 只挑 `kind==='read'` 且
`args` 为空的能力。

## 24. 字段映射的下钻与歧义（align）

`align` 先配集合、再配字段。配字段这一层原来只看顶层，于是「容器配上了，里面全靠人肉」——
`items → lines` 打 94%，但 `count → qty` 没人管，案例一写就错在叶子上。

### 24.1 下钻

对每一个「配上的数组字段」，两侧各取元素画像（把所有行的该数组元素摊平成一组行），
用**同一个打分函数、同一道置信门槛**再配一遍。键形如：

```
items[].count      → lines[].qty
items[].unitPrice  → lines[].unitRate
items[].subTotal   → lines[].lineSum
```

两侧前缀各自用自己的容器名（`items[]` 与 `lines[]`），不共用参照的名字——共用会让
映射表看起来像「目标字段也叫 items」。

### 24.2 歧义：比错配更要紧的一类

```json
{"collection":"orders","path":"count","target_path":"qty",
 "rivals":["quantity"],"confidence":0.94,
 "reason":"两个源字段都自信地指向同一个目标字段，语义重叠，必须人签"}
```

两个源字段都自信地指向同一个目标字段时，**一个都不配**。理由：错配还能靠
「有另一个名字更像」的对手检查发现，语义重叠只能靠冲突发现——而冲突一旦被
「取最高分」的贪心消化掉，就永远看不见了。

### 24.3 取值完全一致且唯一

名字毫无关系、元素行又少时（三条），基数信号只给 0.5，分数卡在 0.65 上不去，
`dishName → label` 这种明显该配的被判未定。补一条：**取值多重集完全一致、且该源字段
只有一个这样的目标**，就采纳。

**只对非数字生效**。数字撞车太常见：28 既是单价也是小计、两个计数都从 1 数到 3，
「取值一样」在数值上不构成身份证据。字符串（菜名、状态名）才有区分度。

### 24.4 比率的分母

分母 = 顶层字段数 + 真正下钻过的元素字段数。只算顶层会让比率超过 100%
（`items` 配上了、里面的三条又都配上，就变成 20 / 17 = 117.6%）。

## 23. 负例候选与实跑（negatives --run）

负例的老问题是判据：机器只看得到「实际返回了什么」，照抄就是放水。这一层换了前提——
**不猜观测，只读声明**，并且把「观察到的结局」与「应该是什么」分开写。

### 23.1 六类候选

| kind | 依据 | 置信 |
|---|---|---|
| `missing_required_arg` | `args` 里不带 `?` 的参数被删掉 | high |
| `role_violation` | `roles` 里没有的身份去调 | high |
| `boundary_violation` | `constraints` 里的 `min`/`max`/`integer`/`enum` | high |
| `wrong_type` | 声明成 number 塞字符串 | medium |
| `unknown_entity` | 主键类参数塞不存在的值 | medium |
| `duplicate_submit` | 写能力重复一次 | low（两个假设都列） |

没有声明就一条都不造。`boundary_violation` 尤其如此：工具能问出 `qty=0`，是因为适配器
自己写了 `min:1`，不是因为工具觉得数字该有个范围。

### 23.2 `--run` 的四类结论

```bash
agent-web negatives cases/coffee --adapter=memory --run [--second=SPEC] [--detail]
```

| observed | 含义 |
|---|---|
| `observed_reject` | 按期望被拒（声明与实现一致，可以进案例） |
| `observed_accept` | 期望被拒却成功了 —— **实现有洞**，或声明写严了 |
| `diverged` | 两个实现结论不同 —— 契约没说清，先别写案例 |
| `unknown` | 跑不出结论（缺观测或环境没起来） |

**看的是最后一步的结局，不是整体判决**。负例本来就会让案例自带的 goal 断言不成立
（「订单数 >= 1」被拒后必然为假），拿整体判决分类等于在测「我把断言改坏了吗」。

### 23.3 候选永远不进判决

每条候选都带 `status: 'disputed'`。观察到的事实不是判据：进 `cases/` 仍要
`agent-web accept --by=NAME` 署名。审阅表（`.agent-web/negatives/`）多一栏「实测」，
汇总多三行，仅此而已。

## 22. 从现成套件转案例（import hurl）

案例写不完是这套工具最硬的墙。`import` 承认这件事，并给出一个不靠猜的入口：
把**别人已经写好的接口测试套件**转成案例草稿。

```bash
agent-web import hurl examples/realworld/hurl --out=cases/realworld [--as=角色] [--uid=固定值]
```

### 22.1 为什么是 hurl

纯文本、有 `[Captures]` 与 `[Asserts]` 段、断言词汇小（`==` / `isString` / `isList` /
`not isEmpty` / `count >= n` / `count == n` / `contains`），每一条都能落到 `payload` 断言上。
Postman 是 JSON 且层层嵌套，Bruno 是自有目录格式，转换成本更高、可读性更差。

### 22.2 转换规则

| hurl | agent-web |
|---|---|
| `POST {{host}}/api/users` + JSON 体 | 一步：`capability: users.create`，body 进 `arguments` |
| `HTTP 201` / `HTTP 422` | `expected_outcome: applied` / `rejected`；`5xx` 整块跳过 |
| `Authorization:` 头 | `as: <--as 指定的角色>`；没有该头则是 `anonymous` |
| `[Captures] slug: jsonpath "$.article.slug"` | 该步 `captures: {slug: "$s2.slug"}`，后续 `{{slug}}` 作为路径参数回填 |
| `[Asserts] jsonpath "$.tags" count >= 1` | `{"kind":"payload","step":3,"path":"$.tags","op":"count_gte","value":1}` |
| `{{uid}}` 之类运行期随机量 | 换成 `--uid` 给的常量（默认 `000000`） |
| 读不懂的断言 | 写进同名 `.todo.md`，**不猜** |

### 22.3 产物与边界

- 每个 `.hurl` → 一条案例，`id: realworld/<文件名>`，`draft.status: unconfirmed`
- 有待办时同时写 `<名字>.todo.md`，一条一行，写清「第几步、哪句、为什么没转」
- **不联网、不执行**：转换器只是文本处理，跑不跑得通取决于适配器
- **不生成适配器**：目标系统没有 `adapter.yml` 或内置适配器时，转出来的案例只能等着
**期望值可以跨步引用。** 现成套件里 `jsonpath "$.articles[0].slug" == "{{slug2}}"` 这种写法很常见：
比对的对象不是常量，而是「前面某一步返回体里的位置」。转换器把它写成 `value_from: "$s3.article.slug"`，
由 `payload` 断言在执行时去第 3 步的返回体里取。取不到就记 `unknown/missing_observation`，不判假。


### 22.4 验收口径

拿 RealWorld 三套件实测：**31 步 / 74 条断言 / 0 处待办**。
转出来的案例必须过 `validateCase`；`test/import-hurl.test.mjs` 守着十二件事
（状态行、捕获、能力名、角色、`expected_outcome`、待办不丢、5xx 跳过、写盘、payload 六种 op、
看不见返回体是 `unknown`、缺参在校验期报错、相位只允许 `trace`）。

### 3.2.1 constraints：参数边界的声明

`manifest.capabilities[].constraints` 是可选的，一旦声明就必须合法——半份约束比没有约束更危险，
因为 `negatives` 会按它派生边界输入，写错了就派生出错的负例。

```json
{"id":"order.create","kind":"write","args":{"items":"Array<{dishId:string, qty:number}>"},
 "constraints":{"items[].qty":{"min":1,"max":99,"integer":true}}}
```

| 约束项 | 含义 |
|---|---|
| `min` / `max` | 数值上下限（含端点）。派生 `min-1` 与 `max+1` |
| `integer` | 必须是整数。派生「非整数」 |
| `enum` | 允许的取值集合。派生「枚举外值」 |

**键是参数路径**，支持点号与数组通配（`items[].qty` 会写进数组每一项）。
校验期就拦三种错：`min > max`、空约束对象、不认识的约束项。

### 4.3.5 recurrence：节律必须跑满

`timeliness` 比的是**两个时刻**之间的间隔。但有一整类系统，它的正确性不在间隔上，
而在**一串时刻**上：每 15 分钟一次的任务，少跑一次、多跑一次、每次都晚 20 分钟，
是三种不同的坏法。`count_delta` 只看总数，在它眼里三者都是「数量不对」。

```json
{
  "kind": "recurrence",
  "selector": { "collection": "runs", "where": [{ "field": "jobId", "eq": 1 }] },
  "field": "scheduledFor",
  "every": "30m",
  "from": "2026-01-01T00:00:00Z",
  "to": "2026-01-01T02:00:00Z",
  "timezone": "UTC",
  "tolerance_ms": 60000,
  "expect_count": 5
}
```

判定顺序固定为 **重复 → 跑偏 → 漏跑 → 数量**，因为它们的修法完全不同：

| 码 | 含义 | 为什么必须单独一个码 |
| --- | --- | --- |
| `recurrence_duplicated` | 同一槽位跑了两次 | 「多一条记录」和「同一个动作执行两遍」不是一回事，后者会让下游算两遍钱 |
| `recurrence_drift` | 落在槽位容差外 | 次数全对、时刻全错；只看数量永远发现不了 |
| `recurrence_gap` | 某个槽位没有对应记录 | 静默漏跑是最贵的坏法，它不报错 |
| `recurrence_count_mismatch` | 命中数与 `expect_count` 不符 | 只有案例显式写了才判 |

三条硬边界，与 `timeliness` 同源：

1. **没声明 `timezone` → `unknown/missing_timezone`**。「每小时一次」在跨时区里没有意义。
2. **记录缺 `field` 时间戳 → `unknown/missing_observation`**。看不见不等于没跑，不判假。
3. **`tolerance_ms` 默认 0**。节律必须精确，除非案例显式放宽；容差同时放宽窗口边界
   （00:45 那一跑晚到 00:50 仍属 00:45 槽位），否则「跑偏」会被误报成「漏跑」。

窗口是**半开区间** `[from, to)`，且**窗口外的行不参与判定**：暂停把时间线切成两段时，
两段窗口会把对方的行判成越界——那不是实现的问题，是断言的问题。
多跑的那一次交给 `count_delta` 或 `event_absent`：**一条断言只回答一个问题**。

### 4.3.4 state_machine：只许走这些边

`status_transition` 能断言「某条边出现过」。它说不出「不许从 PENDING 直接到 PICKED」——
那句话不是关于**出现过的边**，而是关于所有**可能被走**的边。

```json
{"kind":"state_machine",
 "walk":"rows",
 "selector":{"collection":"status_log"},
 "path":"to",
 "states":["PENDING","MAKING","READY","PICKED","CANCELED"],
 "transitions":[["PENDING","MAKING"],["MAKING","READY"],["READY","PICKED"],["PENDING","CANCELED"]]}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `transitions` | **是** | 允许的边。不给就 `unknown/not_declared`——没声明就没约束 |
| `states` | 否 | 全部合法状态。观测到不在其中的值 → `unknown/unknown_state` |
| `walk` | 否 | `snapshots`（默认，跟一个实体走）或 `rows`（把流水集合当序列） |
| `path` | 否 | 取值列，默认 `status` |

**两种 walk 都成立，因为状态机在两个地方都出现**：

- `snapshots`：同一个订单在每一步快照里的 `status` 序列 —— 「这单是不是按规矩走的」。
- `rows`：流水集合每行的 `to` 列 —— 「这份日志里有没有不该出现的边」。
  只走 `snapshots` 会漏掉**追加在末尾**的多余边：快照里只看第一行，后面的行永远看不见。

**相位固定 `trace`**：只判终态等于只看终点，中途跳态会被当成合法。

**独占杀手** `m-illegal-transition-allowed`：在最后一个快照的 `status_log` 末尾追加一条
`PICKED→MAKING`。四条声明的边一条不少，`status_transition` 照样判真，只有这一种断言能发现它。

### 4.3.3 timeliness：真实时间约束

前面的 kind 都在「第几步」这个坐标上工作。`window` 能说「第 2 步到第 3 步之间状态没变」，
但它说不出「发货必须在付款后 24 小时内」——那件事与步号无关，只与真实时间有关。

```json
{"kind":"timeliness",
 "from":{"type":"order.created"},
 "to":{"type":"order.picked"},
 "max":"24h",
 "timezone":"UTC",
 "at_field":"at"}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `from` / `to` | 是 | 事件匹配条件：`type` 按事件类型，`field`+`value` 按任意字段；`pick` 取 `first`（默认）或 `last` |
| `max` / `max_ms` | 二选一 | 上限。`max` 支持 `ms/s/m/h/d`（`24h`、`90m`、`5000ms`、`2d`） |
| `timezone` | **是** | 时区。不给就是 `unknown`——时间比较不能靠猜 |
| `at_field` | 否 | 时间戳字段名，默认 `at` |
| `collection` | 否 | 事件所在集合，默认 `status_log` |

**相位固定 `final`**：时间戳只活在终态视图的事件行上，中间快照里事件还没发生完。
想看「某一步之后还没发货」，用 `window` 套它。

**三条硬边界（写在代码里，不是文档里的君子协定）**

1. 事件没有时间戳 → `unknown/missing_observation`。**看不见不等于做错了**，判假会把
   「没记录时间」和「超时了」混成一件事。
2. 时区没声明 → `unknown/missing_timezone`。跨时区的「24 小时」没有意义。
3. **恰好等于上限算成立**。「24 小时内」包含 24 小时，`gap === max` 判真。
   反过来，`gap < 0`（终点早于起点）判假，那是顺序错了，不是时间不够。

**独占杀手**：`m-shipment-late` 在 `observe` 时把 `order.picked` 那行的 `at` 推后 25 小时，
状态与顺序一字不动。`node scripts/kind-necessity.mjs` 实测「能杀 1 个 / 只有它能杀」。
去掉这条断言，它就漏网——这是这一种 kind 存在的唯一理由。

## 26. 轨迹计数（report --counts）

L3 说「不判质量」，这条不推翻它。它做的是**把能数的东西数出来**：

```bash
agent-web report .tmp-r.jsonl --counts            # 表格
agent-web report .tmp-r.jsonl --counts --json     # 每个案例一个对象，只有五个键
agent-web report .tmp-r.jsonl --counts --cases=cases/coffee   # 才给得出绕路比
```

### 26.1 五个数，定义写死

| 键 | 定义 |
|---|---|
| `steps` | 轨迹长度 |
| `repeat_reads` | 同一**读**能力 + 同一参数，多读的次数 |
| `detour_ratio` | 实走步数 ÷ 案例参考轨迹步数；没有分母时为 `null` |
| `wasted_writes` | 某次写的产出被后面一步引用，而那一步正是它的反操作 |
| `retries` | 同一能力同一参数，上一次没成、这一次期望它成 |

**为什么绕路比的分母必须是参考轨迹**：第一版用「产出被后面引用 / 是该能力最后一次 /
是一次被期望的拒绝」三条结构规则算「必要步数」，实测一条老实巴交的 4 步案例算出 1.33。
那个规则测的是「我这条轨迹自己有多自洽」，不是「比这份案例多走了几步」。
现在分母是案例里那条 `reference_trajectory` 的长度——它才是这份案例认为够用的路径。
**拿不到分母就记 `null`**，不写 1：写 1 会被读成「一步没多走」，那是编的。

### 26.2 它绝不进判决

`--counts` 走的是 `report` 的独立出口，跟 `summarize`/`agreement` 那套指标不共享代码路径。
输出里不许出现 `score`、`grade`、`rank`、`建议`、`优秀`、`较差`、`评分`、`质量分`
——`test/report-counts.test.mjs` 会逐词扫输出文本，出现一个就红。

这不是洁癖。一旦有分数，下一个问题就是「多少分算过」，接着是「跨项目怎么比」，
最后 L3 从 `by-design` 变回 `open`，等于把这个项目绕开的问题又请回来。

### 26.3 证据里为什么要留参数

`evidence.trace[]` 原本只留 `capability` 与 `outcome`，`arguments` 被投影掉了。
数重复读靠的就是参数：不留参数，「读两次同一个列表」和「读了两个不同列表」长得一模一样。
现在每个 trace 条目带 `arguments`，判决文件仍然可以离线复查。

---

## 27. 外部报告摄入（ingest）

### 27.1 为什么要有这条命令

「我们能不能验别人的测试套件」这个问题，如果只回答「能/不能」，两个答案都是空的。
能回答它的东西是一条**翻译加计数**：把别家报告的判决词汇翻成
`pass / fail / unknown / not_run`，然后数出其中有多少真的证明了产品行为。

`ingest` 只做这一件事。它**不**声称「外部测试等于本仓库的案例」，
它的产物也**不**进 `report --counts`——外部报告的 `pass` 不是本仓库的 `pass`，
混在一起数就是在给自己记虚功。

### 27.2 翻译表是穷举的，不是白名单的兜底

| 外部状态 | 我们的判决 | 理由 |
|---|---|---|
| `passed` | `pass` | 带 `expectedFailure` 时例外，见 27.3 |
| `failed` | `fail` | |
| `flaky` / `timed-out` / `interrupted` / `skipped(explicit)` | `unknown` | 没稳定证明任何事，但留在分母里 |
| `skipped(filtered)` + `selected: false` | `not_run` | 没被选中跑，连分母都不该进 |
| `blocked` / 运行层事故（`run.errors[]`） | `unknown` | 环境或预算挡住的，不是产品判决 |
| 表外状态 | `unknown` + `reason_code: 'unmapped_status:<原值>'`，**退 2** | 认不出就说认不出 |

最后一行是这条命令的立场：**没见过的状态绝不默认成 `pass`**。
一个把所有未知都当成功的工具，比一个不存在的工具更危险。

### 27.3 两个陷阱

**`passed` 可能是「缺陷还在」。** 有的框架用 `expectedFailure` 声明「这条本来就会失败」，
一条已知缺陷仍然存在时，结果反而是 `passed`。所以 `ingest` 把它记成
`pass` 加 `reason_code: 'expected_failure_still_present'`，单独数一笔，并在文本报告里报警。

**分母要含运行层事故。** 昂贵的 hook 挂了导致一批测试没跑，这些测试既不是过也不是不过；
把它们排除在分母外，等于替产品把它们判成过。可判定率的分母因此是
「进了分母的结果数 + 事故数」。

### 27.4 三个数，各回答一个问题

1. **可判定率** = (pass + fail) / 分母。回答：「跑完这一轮，有多少条真的有了结论。」
2. **机器判定占比** = 机器断言行判出的判决 / (pass + fail)。
   回答：「这些结论里，有多少换了实现也还成立。」
   由模型说「看起来对」判出来的 `pass`，在我们口径里算 `blind`。
3. **一条断言都没有的判决数**。回答：「有多少条是纯粹的执行成功，什么都没验。」

实测（拿 `tester-army/e2e` 仓库的官方 fixture）：4 条结果里唯一一条断言是 `agent.assert`，
机器判定占比因此是 **0.0%**——这个 0 不是算错，是那套套件的事实。

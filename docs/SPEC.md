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

### 4.1 十二种 kind

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

### 4.3 相位

相位决定求值时机，是语义的一部分：

- `final`：终态上求值。
- `initial_vs_final`：比较初态与终态。
- `trace`：在状态流水上求值。

把 `trace` 类断言放到终态上求值会漏掉"中间走错又走回来"，因此**实现必须按相位表求值，案例不得指定相位**。

### 4.4 `selector`

```json
{ "collection": "orders", "where": [{ "field": "status", "eq": "READY" }], "index": 0 }
```

- `collection`：观测域里的集合名。
- `where`：可选，谓词数组，全部满足才算命中。
- `index`：可选，命中集合里的下标；省略表示"全部命中"。

谓词运算：`eq` `ne` `in` `exists` `gt` `lt` `gte` `lte` `contains`。

选中 0 个实体 → 断言为 `unknown / missing_observation`，**不是** `false`。空集不构成反证。

### 4.5 `path`

点号路径，从实体根写起：`status`、`items.length`、`items.0.count`。`length` 是特殊键，取数组长度。

取值不存在 → 断言为 `unknown`（观测不足），不是 `false`。

---

### 4.6 形状断言：唯一性、类型、值域、顺序

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

### 4.7 形状断言的边界：一条实测

`cases/coffee/shape.json` 里**没有** `sorted_by`，只有另外三种。原因是实测出来的：

```
memory 适配器          → pass
真实咖啡店后端 (8180)  → fail（第 0 行比第 1 行新）
```

两边都没把「列表按什么排」写进契约。这时候断言升序不是抓到了 bug，是**自己造了一个假红**。
所以它被挪到 `examples/shape-order/`，只对 mock 跑，当一个用法示范。

这和 `m-pickup-no-offset`（取餐号偏移 100）是同一类：**能被观测到，不等于值得被断言**。

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

`Outcome` 四选一：

| outcome | 含义 |
| --- | --- |
| `applied` | 执行成功，`payload` 带返回值 |
| `rejected` | 业务层拒绝（越权、非法迁移、参数不合法），`error.code` 必填 |
| `unsupported` | 适配器演不了这个能力（**不是**失败） |
| `infra_error` | 适配器自己坏了（网络、令牌过期、解析失败） |

区分 `rejected` 与 `infra_error` 很关键：前者是**被测系统的行为**，后者是**测量仪器故障**。把仪器故障记成"系统拒绝"会凭空造出一次假失败。

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
| 11 | 适配器返回 `unsupported` | unknown | `coverage_gap` |
| 12 | 适配器返回 `infra_error` | unknown | `infrastructure_error` |
| 13 | 应成功却被拒绝 | fail | `unexpected_rejection` |
| 14 | 应被拒绝却成功了 | fail | `expected_rejection` |
| 15 | 目标断言为假 | fail | `assertion_false` |
| 16 | 不变量为假 | fail | `invariant_violated` |
| 17 | 任一断言为 unknown | unknown | `missing_observation`（若所有判不了的断言原因相同且在白名单内，用该原因，例如 `unsupported_event`） |
| 18 | 全部成立 | pass | `ok` |
| — | 未捕获异常 | unknown | `infrastructure_error` |

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
| 3 | 用法错误、路径不存在、适配器名未知 |

`unknown` 计为不一致：拿不准就当红灯，别当绿灯。

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
| `unusable` | 判决本身无效（`reason_code: infrastructure_error`），不参与任何比率 |

`guarded` 只表示「有据可查」，不表示「安全」：适配器可以谎报。规范不要求验证凭据的真伪，只要求把凭据留下来。

探测器自身抛错时按 `blind` 记录并附原因，不得静默跳过——探测器坏了和风险未覆盖是同一件事。

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
| `--min=X` | `rate !== null` 且 `rate >= X` |

`rate` 为 `null` 时一律不算通过 —— 一道题都没批改，不能算 100%。

### 13.5 不许做的事

- 不许引入"由模型判断断言够不够狠"。判分只认 `killed`，不认解释。
- 不许把 `unarmed` 当作 `killed`。在正确实现上就不成立的断言，对任何实现都没有区别力。
- 不许为了让分数好看而剔除 `missed` 的题。题的集合由 13.1 的三条决定，不由成绩决定。

## 14. 探针（probe）

前面所有命令都建立在一个前提上：**适配器给的观测是真的**。这个前提此前从未被检查过。

一份撒谎的适配器不会报错，它只是安静地准：判决是真的判决，只是测的不是你以为的东西。
所以：**换成新适配器，先跑探针，再谈判决。**

### 14.1 查什么

| 检查 | 判据 | 失败意味着 |
| --- | --- | --- |
| 契约 | 五方法齐全、`manifest()` 通过 `validateManifest` | 适配器没写完 |
| 复位幂等 | 连续两次 `reset` 后的初始视图指纹相同 | 复位没落实到可观测状态上 |
| 观测稳定 | 同一状态连读两次指纹相同 | 视图里混进时钟或随机数，`count_delta` 会随机漂移 |
| 无状态泄漏 | 写一轮再 `reset`，仍等于第一份初态 | 上一轮的残留会流进下一轮，判决之间不再独立 |
| 空参不炸 | 每条能力用空参数调一次，不得抛异常、不得 `infra_error` | 参数校验没做，Agent 一乱调就崩 |
| 写了要变 | 声明 `applied` 的写操作之后视图毫无变化 → **只报警** | 可能是假执行，也可能这个写本来就不改规范视图 |

最后一条只报警不判死，是刻意的：发通知、写审计日志这类写操作本来就不改视图，替人判死会制造误报。
探针给的是「这几件可机械判定的事上没有矛盾」，不是「这个适配器可信」。

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

## 18. 版本演进

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

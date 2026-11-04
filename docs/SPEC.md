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

### 4.1 七种 kind

| kind | 必填参数 | 相位 |
| --- | --- | --- |
| `entity_exists` | `selector`, `min?`(默认 1), `exact?` | final |
| `field_equals` | `selector`, `path`, `value` | final |
| `count_delta` | `selector`, `delta` | initial_vs_final |
| `unchanged` | `scopes`(观测域名数组) | initial_vs_final |
| `status_transition` | `selector`, `path`, `transitions`(二元组数组) | trace |
| `event_absent` | `type` 或 `selector` | trace |
| `composite` | `op`(`and`/`or`/`not`), `args` | 由子断言决定 |

**没有 `llm_judge`，也不接受自定义扩展 kind。** 未知 kind 一律 `invalid_case`。

### 4.2 相位

相位决定求值时机，是语义的一部分：

- `final`：终态上求值。
- `initial_vs_final`：比较初态与终态。
- `trace`：在状态流水上求值。

把 `trace` 类断言放到终态上求值会漏掉"中间走错又走回来"，因此**实现必须按相位表求值，案例不得指定相位**。

### 4.3 `selector`

```json
{ "collection": "orders", "where": [{ "field": "status", "eq": "READY" }], "index": 0 }
```

- `collection`：观测域里的集合名。
- `where`：可选，谓词数组，全部满足才算命中。
- `index`：可选，命中集合里的下标；省略表示"全部命中"。

谓词运算：`eq` `ne` `in` `exists` `gt` `lt` `gte` `lte` `contains`。

选中 0 个实体 → 断言为 `unknown / missing_observation`，**不是** `false`。空集不构成反证。

### 4.4 `path`

点号路径，从实体根写起：`status`、`items.length`、`items.0.count`。`length` 是特殊键，取数组长度。

取值不存在 → 断言为 `unknown`（观测不足），不是 `false`。

---

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

## 7. 判决顺序

实现必须按以下顺序判定，先命中先返回。顺序本身是规范的一部分：它决定了多个问题同时存在时报哪一个。

| # | 条件 | 判决 | reason_code |
| --- | --- | --- | --- |
| 1 | 案例格式校验失败 | unknown | `invalid_case` |
| 2 | `manifest()` 抛错 | unknown | `invalid_environment` |
| 3 | manifest 不符合契约 | unknown | `invalid_environment` |
| 4 | 复位后观测不到初态 | unknown | `missing_observation` |
| 5 | 前置条件为假 | unknown | `invalid_initial_state` |
| 6 | 前置条件无法求值 | unknown | `missing_observation` |
| 7 | 步的能力不在 manifest | unknown | `coverage_gap` |
| 8 | 步的能力不在 `allowed_capabilities` | fail | `invalid_action` |
| 9 | 参数绑定失败 | fail | `invalid_action` |
| 10 | 适配器返回 `unsupported` | unknown | `coverage_gap` |
| 11 | 适配器返回 `infra_error` | unknown | `infrastructure_error` |
| 12 | 应成功却被拒绝 | fail | `unexpected_rejection` |
| 13 | 应被拒绝却成功了 | fail | `expected_rejection` |
| 14 | 目标断言为假 | fail | `assertion_false` |
| 15 | 不变量为假 | fail | `invariant_violated` |
| 16 | 任一断言为 unknown | unknown | `missing_observation` |
| 17 | 全部成立 | pass | `ok` |
| — | 未捕获异常 | unknown | `infrastructure_error` |

注意 5 与 14 的不对称：**前置条件为假判 unknown 而不是 fail**。初态不干净是环境问题，不是被测系统的错。把环境问题记成 fail，会把噪声算进被测对象头上。

注意 12 优先于 14：一步该成功却被挡下，就没必要再评速度与终态了，首因更清楚。

---

## 8. 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 全部判决与预期一致 |
| 1 | 存在不一致（含 unknown 与预期不符） |
| 2 | 用法错误、路径不存在、适配器名未知 |

`unknown` 计为不一致：拿不准就当红灯，别当绿灯。

---

## 9. 版本演进

`0.1` 之后允许的改动：

- 新增断言 kind（向后兼容）
- 新增 manifest 字段（必须可选）
- 新增 `evidence_level` 取值

不允许的改动：

- 改判决顺序表
- 改相位表
- 给 `unknown` 换语义
- 引入任何形式的模型判定

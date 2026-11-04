# 把 agent-web 接到你自己的网站

一句话：**读接口机器接，写语义你来写**。这篇说清那条线在哪、每一档要花多少功夫、最容易错的地方是哪几处。

先判断你的站在哪一档：

| 你的站 | 走哪条路 | 要花的时间 |
| --- | --- | --- |
| 有 OpenAPI / Swagger 描述 | `discover`，全自动 | 五分钟 |
| 没有接口描述，但能抓到请求日志 | `record` + `prepare` | 半小时 |
| 要测真实业务规则（状态机、权限、不变量） | 手写适配器 | 半天 |

三档是**叠加**的，不是三选一：第一档的产物可以直接拿来当第三档的起点。

---

## 第一档：全自动（五分钟）

```bash
bash quickstart.sh http://127.0.0.1:8080
```

它会探测根路径和 8 个常见的接口描述位置（`/openapi.json`、`/v3/api-docs`、`/swagger.json`……），
找到就生成两份东西：

- `adapter.mjs`：只读适配器，每个 GET 接口一个能力
- `cases/*.json`：每资源一条案例，断言只有一条——读操作不得改变任何东西（`unchanged`）

```bash
node bin/agent-web.mjs probe --adapter=adapter.mjs     # 六项自洽检查
node bin/agent-web.mjs accept cases/orders.json --by=你的名字
node bin/agent-web.mjs verify . --adapter=adapter.mjs
```

三条边界，写死在代码里：

1. **写操作不猜。** 机器不知道「取消订单之后什么必须为真」，所以 create/delete/update 一律标 `unsupported`。
2. **路径不猜。** 带参数的接口（`GET /orders/{id}`）标 `skipped`，不硬拼一个 id 去打——拼出来的 404 是假失败。
3. **生成的案例一律是草稿。** 不过 `accept --by=` 不出判决，机器生成的东西不能自己给自己作证。

`discover --writes` 会多做一步：给 POST 到集合路径的 create 接口生成往返案例
（调完之后列表里应该多一条）。它抓的是「接口回 200 但什么都没写进去」这类假装成功。

## 第二档：从日志走（半小时）

站点没有接口描述，但你有真实流量（或自己点一遍抓下来）：

```bash
node bin/agent-web.mjs record 流量.jsonl --adapter=适配器 --out=轨迹.json
node bin/agent-web.mjs prepare 轨迹.json
```

`record` 把请求日志还原成带绑定（`$s1.orderId`）的步骤，`prepare` 生成案例草稿和流程图。
**日志格式是 JSONL 动作日志，不是 HAR**——先看 `examples/agent-traces/` 里的样子。

## 第三档：手写适配器（半天，这是主路）

要测「未审核的任务不能被接取」「只有执行者能完成」「积分只发一次」这类规则，机器帮不了你——
**这些语义只存在于你的业务里**。但也不吓人：仓库里有两份完整的真实范例，照抄改四处。

- `examples/animal-tracking/adapter.mjs`（推荐模板：审核流、执行者校验、积分）
- `src/adapter/taixianglian.mjs`（咖啡店：订单状态机、角色权限）

### 要改的就四处

**① 能力表。** 你的接口一行一个：

```js
capabilities: [
  { id: 'task.approve', kind: 'write', evidence_level: 'validated',
    roles: ['admin'], http: 'PUT /api/v1/tasks/{id}/approve' },
]
```

**② 返回口径（`classify()`，最容易错的一处）。** 你的后端把「业务拒绝」报成什么 HTTP 状态？
这决定了案例里 `expected_outcome: rejected` 能不能拿到：

- 咖啡店和 animal 后端都是 `IllegalArgumentException` → 400 → 归 `rejected`，对
- 如果你的后端用 **403 表业务拒绝**（权限不足），按默认口径会被归成 `infra_error` → 判决变 `unknown`
  ——不是 bug，是口径错位，改你的 `classify()`，让 403 按语义分流
- 401 / 429 / 5xx 永远是 `infra_error`：那些是环境问题，记成 Agent 的错就是冤案

**③ 规范视图（`observe()`）。** 把你的接口投影成几个集合，每个集合固定字段。
字段名跨实现必须一致——这就是「同一份案例能打两个实现」的全部前提。
两条铁律：

- 不可移植字段（id、时间戳、username）可以观测，但别在案例里断言它们
- 字典/枚举值要和对照实现对齐（咖啡店曾因 mock 菜名「美式」≠ 真实「美式咖啡」全盘翻红）

**④ 隔离（`reset()`）。** 三条路，按便宜程度：

1. `identity`：应用自带账号体系，每次 reset 注册新账号——天然隔离，最便宜
2. `reseed`：自建后端，清库重灌
3. `snapshot`：整份状态快照

注意一个真实踩过的坑：**你的后端可能对登录接口限流**，而 reset 每次要登录。
长寿命账号的 token 按进程缓存（见 `adapter.mjs` 的 `loginAdmin`），失效才重登。

### 写完之后的顺序

```bash
node bin/agent-web.mjs probe --adapter=你的适配器.mjs      # 先证明观测自洽
node bin/agent-web.mjs verify 你的案例/ --adapter=...      # 一条案例跑通
node bin/agent-web.mjs certify 你的案例/ --adapter=...     # 断言证明自己有用
node bin/agent-web.mjs compare 你的案例/ --adapters=memory,你的适配器
```

`compare` 是终审：同一份案例打两个实现，判决必须一致。不一致只有两种解释——
要么某个实现有洞（真发现），要么断言空转（certify 会指出）。

---

## 四个别人已经替你踩过的坑

全在 `knowledge/`（`agent-web knowledge` 可查），接新网站时最容易撞：

1. 登录限流打断频繁 reset → token 缓存
2. mock 的字典值和真实后端不一致 → 观测层对齐
3. 建议断言给到不可移植字段（`id = 1`）→ 断言值域字段
4. 403 当业务拒绝还是故障 → 先读你后端的异常处理器

## 一条红线

适配器是普通 Node 模块，加载即以你的权限执行任意代码。**只加载你信得过的**——
第一次接手别人的适配器，先读源码，看有没有 `fetch` 到意料之外的地方。

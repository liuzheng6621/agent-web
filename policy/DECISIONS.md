# 咖啡店规则的第二次声明：决策记录

这份文件记的是**规则本身**，不是测试。`policy/coffee.rego` 是这些规则的可执行副本，
`policy/fixtures/*.json` 是它们的判例。三样东西加起来才算「第二条通道」。

为什么要有第二次声明：`agent-web` 的案例断言只能证明「我写下的判据过了」，
证明不了「我写下的判据对不对」。Rego 那份不是从 Java 翻译来的，
而是照这份文档重新写一遍——两边都错到同一处的概率，远低于单边出错。

## 0. 输入形状

策略吃一个对象：`{ orders: [...], events: [...] }`。

| 字段 | 来源 | 说明 |
|---|---|---|
| `orders[].id` | `t_order.id` | 订单号 |
| `orders[].userId` | 用户名 → id 查表 | **不推断**，查不到写 `null`，由 R7 报出来 |
| `orders[].totalAmount` | `t_order.total_amount` | 订单总额 |
| `orders[].items[]` | `t_order_item` | `dishName/count/unitPrice/subTotal` |
| `events[].orderId` | `t_order_status_log.order_id` | 事件所属订单 |
| `events[].from` | `from_status` | 起点事件为 `null` |
| `events[].to` | `to_status` | |
| `events[].operatorId` | 用户名 → id 查表 | `SYSTEM` 恒为 `null` |
| `events[].operatorRole` | `operator_role` | `STAFF` / `CUSTOMER` / `SYSTEM` |
| `events[].at` | `created_at` | 同订单内升序 |

**唯一一处合成**：后端下单**不写** `t_order_status_log`（`docs/domains/` 有记录），
所以每张订单的 `null -> PENDING` 起点事件由胶水从 `orders` 行合成，
`operatorRole` 固定 `CUSTOMER`、`operatorId` 取订单属主。这是后端语义事实，不是策略的选择；
胶水里的 `START_FROM` / `START_TO` 两个常量就是它，改动即视为改规则，须过判例。

## 1. 规则清单

每条规则在 Java 里有唯一权威处，在 Rego 里有独立副本。**权威处指 Java**——
生产环境跑的是它。Rego 只在两边打架时充当报警器，不充当修正器。

| 号 | 规则 | Java 权威处 | 判例 |
|---|---|---|---|
| R1 | 迁移只能是四条边之一；首事件必须是 `null -> PENDING` | `common/OrderStateMachine.java` `ALLOWED` 表 | `bad-illegal-edge` `bad-no-start` |
| R2 | 终态（`PICKED`/`CANCELED`）不可离开 | 同上，`ALLOWED` 里两个终态是空集 | `bad-terminal-leave` |
| R3 | 店员可走任意合法边；顾客只能 `-> CANCELED` 或 `-> PICKED` | 同上，`roleCan()` | `bad-customer-accept` |
| R4 | 同一订单的相邻事件必须首尾相接 | `service/OrderFlowService.java` `doTransition()` 从当前状态取 `from` | `bad-chain-break` |
| R5 | 订单总额 = 明细小计之和 | `service/OrderService.java` 下单时按明细算总额 | `bad-total-drift` `bad-subtotal-drift` |
| R6 | 明细小计 = 单价 × 份数；份数 ∈ [1, 99] | `dto/OrderRequest.java` `@Min(1) @Max(99)` | `bad-count-zero` `bad-count-huge` |
| R7 | 顾客只能动自己的订单 | `OrderFlowService.loadVisible()`（越权与不存在同返 40402） | `bad-cross-user` |
| R8 | 系统只能取消待接单 | `OrderFlowService.cancelStalePending()` 硬编码 `PENDING -> CANCELED` | `bad-system-accept` |

## 2. 已知的三处「两边都对」的差异（不算打架）

1. **越权拒绝码**：Java 用 `40402 订单不存在`（故意把越权和不存在混起来，防 id 枚举）；
   策略只判「这次动作该不该允许」，不判拒绝码该是多少。拒绝码归 L1 形状层的案例断言管，
   两处口径不同是设计，不是漂移。
2. **系统角色的状态机身份**：`doTransition()` 把 `SYSTEM` 映射成 `STAFF` 走状态机
   （`machineRole`），但流水里 `operator_role` 记 `SYSTEM`。所以 R8 是**额外**约束：
   状态机允许 STAFF 走更多边，业务上系统只许取消。策略按流水里的角色判，故需 R8。
3. **终态的 `actions` 清单**：`OrderActionPolicy` 会为终态算出空清单，但不报错；
   策略也不要求「终态必须有人点过」。这是展示层与规则层的分工。

## 3. 什么时候要改这份文件

- Java 里改了 `OrderStateMachine` 的边、`roleCan` 的分支、或错误码语义 → 三处同步：
  `coffee.rego` 的规则、本文件的表格、`policy/fixtures/` 的判例。
- 新增一条业务规则 → 先在本文件写下权威处，再写 Rego，再造一条 `bad-*` 判例。
  **判例造不出来 = 规则还没被真正定义**，不加。
- 只改 Rego 不改 Java，或反之 → `scripts/policy-check.mjs` 会红。这就是它的全部价值。

## 4. 这份声明**不**覆盖什么

- 金额的**业务正确性**（拿铁该不该卖 28 元）——规则只查自洽，不查定价。
- 跨订单的时序（「先做 A 再做 B」）——需要 `precedence` 断言，属 S4。
- 并发下的一致性——策略看的是快照，不是执行过程。
- 拒绝码本身对不对——归 L1 案例断言。

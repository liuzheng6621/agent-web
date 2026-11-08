# 咖啡店域（taixianglian）

真实后端：`E:\咖啡店`（Spring Boot 4.1.1 / Java 21 / H2）。两条观测通道：

| 通道 | 适配器 | 观测方式 |
|---|---|---|
| A · 行为 | `taixianglian` | HTTP：调接口、读响应体 |
| B · 事实 | `taixianglian-sql` | 外部 H2 Shell 进程直读表（只读） |

`execute` 两条通道同源（同一份 `createTaixianglianAdapter`），只有 `observe` 不同。
所以 `compare` 比的是**同一个动作在两条观测通道下的判决是否一致**，
一致率 12/12 是 v0.68.0 的实测结果。

## 语义层（第三层，v0.70.0）

`policy/coffee.rego` 是咖啡店业务规则的**第二次声明**，独立于 Java 重写一遍。
`policy/glue.mjs` 把 `taixianglian-sql` 的 canonical view 翻成策略输入，
`conftest` 判 allow/deny。规则清单与权威处对照见 `policy/DECISIONS.md`。

八条规则：

| 号 | 规则 | Java 权威处 |
|---|---|---|
| R1 | 迁移只能是四条边之一 | `common/OrderStateMachine.java` `ALLOWED` |
| R2 | 终态不可离开 | 同上（两个终态是空集） |
| R3 | 顾客只能 `-> CANCELED` / `-> PICKED` | 同上 `roleCan()` |
| R4 | 相邻事件首尾相接 | `service/OrderFlowService.java` `doTransition()` |
| R5 | 总额 = 明细小计之和 | `service/OrderService.java` |
| R6 | 小计 = 单价 × 份数；份数 ∈ [1,99] | `dto/OrderRequest.java` `@Min/@Max` |
| R7 | 顾客只能动自己的订单 | `OrderFlowService.loadVisible()` |
| R8 | 系统只能取消待接单 | `OrderFlowService.cancelStalePending()` |

判例 11 条（1 好 10 坏）在 `policy/fixtures/`，`node scripts/policy-check.mjs` 逐条判。
缺 `conftest` 时该脚本退出 2 并明示，不静默通过。

## 后端事实（写案例前必看）

- **下单不写 `t_order_status_log`**。流水第一条是 `PENDING -> MAKING`（店员接单）。
  所以「订单创建」这个事件必须由胶水从 `orders` 行合成，`policy/glue.mjs` 里的
  `START_FROM`/`START_TO` 两个常量就是它。
- **越权与不存在同返 40402**（防 id 枚举）。策略只判「该不该允许」，不判拒绝码。
- **`SYSTEM` 角色**在状态机里映射成 `STAFF`（`doTransition` 的 `machineRole`），
  但流水里记 `SYSTEM`。R8 是因此额外加的约束。
- **pickupNo 不落库**，是 `100 + id` 的运行期规则。
- **超时自动取消**：`OrderMaintenanceJob` 每 15s 扫一次，`PENDING` 超过
  `demo.pending-timeout-minutes`（默认 2 分钟）自动转 `CANCELED`，`operator_role=SYSTEM`。
- **H2 库文件** `E:/咖啡店/.awdb/nanpodb.mv.db`，`AUTO_SERVER=TRUE;AUTO_SERVER_PORT=9199`。
  URL 必须是 `./.awdb/nanpodb`（隐式相对路径被 H2 2.4.240 拒绝），
  且不能同时写 `DB_CLOSE_ON_EXIT=FALSE`（与 AUTO_SERVER 冲突）。

## 已知的「两通道不一致」

`cases/coffee/happy-path` 与 `linkage-events` 在两条通道上都 fail，原因是
**memory 适配器下单时 push 一条 `order.created`**，真实后端不落这条。
这是域语义差异，不是通道差异——B 通道忠实复现了 A 的形状。
改案例断言或改后端都行，但两边必须一起改，否则 `compare` 会一直报同一处。

## 怎么跑

```bash
# 后端（后台）
cd E:/咖啡店 && "E:/java/IntelliJ IDEA 2025.1.1.1/jbr/bin/java.exe" -jar \
  target/taixianglian-0.0.1-SNAPSHOT.jar --spring.profiles.active=dev --server.port=8099 \
  "--spring.datasource.url=jdbc:h2:file:./.awdb/nanpodb;AUTO_SERVER=TRUE;AUTO_SERVER_PORT=9199"

# 行为通道
node bin/agent-web.mjs verify cases/coffee --adapter=taixianglian

# 事实通道
TAIXIANGLIAN_SQL_JAVA="E:/java/IntelliJ IDEA 2025.1.1.1/jbr/bin/java.exe" \
TAIXIANGLIAN_SQL_H2_JAR="E:/java/rpo/com/h2database/h2/2.4.240/h2-2.4.240.jar" \
TAIXIANGLIAN_SQL_DB_URL="jdbc:h2:file:E:/咖啡店/.awdb/nanpodb;AUTO_SERVER=TRUE;AUTO_SERVER_PORT=9199" \
node bin/agent-web.mjs verify cases/coffee-sql --adapter=taixianglian-sql

# 两条通道对照
node bin/agent-web.mjs compare cases/coffee --adapters=taixianglian,taixianglian-sql

# 语义层
CONFTEST_BIN=<conftest 路径> node scripts/policy-check.mjs
```

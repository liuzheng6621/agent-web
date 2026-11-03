# 参考被测系统：咖啡店后端

`cases/taixianglian/` 里的七条案例打的是这个后端。它不在本仓库里，作用是提供一个**真实**的对照组——有数据库、有 JWT、有角色、有状态机，不是玩具。

## 系统是什么

奶茶/咖啡店的点单系统：菜单、下单、店员接单、出餐、取餐、取消，加角色与状态流水。技术栈 Spring Boot + H2。

订单五态：

```
PENDING ──→ MAKING ──→ READY ──→ PICKED
   └──→ CANCELED
```

权威规则在 `OrderStateMachine`：`PENDING→{MAKING,CANCELED}`、`MAKING→{READY}`、`READY→{PICKED}`，`PICKED` 与 `CANCELED` 是终态。

## 怎么起

```bash
java -jar target/taixianglian-0.0.1-SNAPSHOT.jar --server.port=8180
```

预置店员账号：`barista` / `latte123`。顾客账号由适配器在每次 reset 时现注册。

## 它为什么适合当对照组

- **有身份**：注册/登录/两条角色，才能测越权。`docs/FINDING-001.md` 那个 bug 就是靠这一点暴露的。
- **有状态机**：非法迁移会返回 40901，才能写"跳步应当被拒绝"这种负例。
- **有流水**：`status_log` 让 `status_transition` 与 `event_absent` 有东西可查。
- **能反复 reset**：适配器用 `identity` 策略，每条案例新账号，不碰任何存量数据。

## 适配器

`src/adapter/taixianglian.mjs`。它把 HTTP 响应投影成规范视图，是"手写适配器"的完整样例——约 11KB，照着接口文档一条条来。这是目前最贵的一步，也是 `0.2` 想改善的地方。

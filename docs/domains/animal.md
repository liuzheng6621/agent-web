# 第三个域：流浪动物保护追踪系统

`E:\java\Git\加了\animal`（Spring Boot 3.2 + JPA + MySQL 8，前端 Vue 3）。
选它做第三个域，不是因为它像咖啡店，而是因为它**处处不像**：

| | 咖啡店（taixianglian） | 动物追踪（animal） |
|---|---|---|
| 信封 | `{ list: [...] }` | Spring Page：`{content,totalElements,totalPages,size,number}` |
| 状态字面量 | 小写 `PENDING` | 大写 `PENDING` / `APPROVED` / `REJECTED`，动物自己还有 `active` / `offline` / `adopted` |
| 角色 | customer / customer2 / staff | admin / volunteer / user（三个真实账号） |
| 幂等与重复 | 重复取餐有业务码 | 驳回没有状态护栏（见 F2） |
| 事件流 | 有 `t_order_status_log` 状态迁移流水 | 没有实体事件流，只有审计日志 ⇒ `events_complete: false` |

案例写法几乎不用改：改的是适配器（怎么把 Spring Page 摊平成规范视图），不是案例（一份案例跑两个实现）。

## 怎么跑

```bash
# 1) 起后端（MySQL 在 3306，库 animal_tracking 已有数据）
cd "E:/java/Git/加了/animal/backend"
mvn -o -DskipTests package
java -jar target/animal-tracking-1.0.0.jar --spring.profiles.active=dev --server.port=8181

# 2) 探针：适配器在这六件机械性质上自洽吗
node bin/agent-web.mjs probe --adapter=animal

# 3) 整域跑一遍（4 条案例 + 预期标签）
node bin/agent-web.mjs verify cases/animal --adapter=animal

# 4) 判据准入：27 个变异体里，这个适配器能坏的方式有几个
node bin/agent-web.mjs certify cases/animal --adapter=animal
```

实测：`probe` 6/6 通过；`verify` 4/4 与预期一致；`certify` **抓到 1 / 欠账 1 / 不适用 23**（跑完约 90 秒）。

**登录有每分钟限流**（`尝试次数过多，请1分钟后再试`），所以 token 缓存在 `.agent-web/animal-tokens.json`（20 小时有效）。
首次 reset 三个账号各登录一次；中途反复登录会被限流，这是基础设施问题，不是业务拒绝。

## 这个域抓到的东西

四个案例里三个 pass、**一个 fail —— 而那个 fail 是真的**。

### F1 审批接口没有角色检查（`adoption-reject-forbidden`）

`SecurityConfig` 只对 `/api/v1/admin/**` 要求 ADMIN，其余一律 `authenticated()`：

```java
.requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
.anyRequest().authenticated()
```

于是 `PUT /api/v1/adoptions/{id}/approve` 与 `/reject` **任何登录用户都能调**。证据不是猜的：
我第一次用 `user` 身份的 token 调 `approve`，返回 200，库里那一行变成

```
id=5  status=APPROVED  reviewer=user  reviewComment=审核通过  reviewedAt=2026-11-05T20:47:33
```

—— 申请人自己批了自己的领养申请，`reviewer` 记的是 `user`。

案例断言写的是「用户点驳回必须被拒绝，申请停在 PENDING」，机器判：

```
fail  animal/adoption-reject-forbidden  expected_rejection
└ adoptions.reject 应被拒绝，实际被执行
```

**这条案例故意用 `reject` 而不是 `approve`**：`reject` 不改动物档案，可以重复跑；
`approve` 会把动物置成 `adopted`，跑一次就把前置条件毁掉（这条后端的 `PUT /animals/{id}` 不接受 `status` 字段，没法回滚）。

### F2 驳回没有状态护栏

`rejectApplication` 只做 `findById`，不看当前状态，也没有「已被驳回/已被通过」的判断：

```java
if (application != null) {
    application.setStatus("REJECTED");
    ...
}
```

也就是说一个已经 `APPROVED` 的申请还能被改成 `REJECTED`（而动物档案仍是 `adopted` —— 两个真相）。
`approve` 那边只挡「动物已被领养」，不挡「申请已经批过」。

### F3 列表的 `status` 过滤没生效

`GET /api/v1/adoptions?status=PENDING` 返回的行里 status 是 `APPROVED`。控制器收了 `status` 参数但没往下传。
案例里没有把这条写成断言（会写成一条假失败），记在这里。

### F4 `/api/v1/points/records` 返回 500

`{"success":false,"message":"服务器内部错误"}`。积分流水页拿不到数据。

## 变异体为什么只有 1 个能抓

27 个变异体里 23 个「不适用」：它们声明的是 `orders` / `menu` / `status_log` 这些咖啡店集合，
这个适配器没有 —— **不进分母**，也不算漏网。这就是 `applies_to` 那套机制存在的意义：
变异体是**域局部**的，判据准入的分母必须跟着域走。

能抓到的那个是 `m-no-reject`（把「该拒的不拒」变成「照单全收」）—— 判决级 ×1。
`m-foreign-write-allowed` 是**欠账**（可杀，缺断言）：这次留下的两个可观测差异，
要补的断言大概率是「`user` 调 approve 后动物的 `status` 必须仍是 `offline`」。

## 还没做的

- **写操作的语义仍然要人给**：这个域我只写了领养一条链（提交 → 驳回），救助申请、志愿者审批、积分发放都没进案例。
- **一个实现，没有孪生**：咖啡店有内存孪生可以 `compare`，这里只有真实后端，所以没有跨实现对照。
  要补的话最省事的是用 `tap` 录一段流量长出孪生（`node bin/agent-web.mjs tap --target=http://127.0.0.1:8181 ...`）。
- **MQTT / WebSocket 链路**没有接：那部分是推送，不是「一次业务操作」，超出当前判决模型的边界。

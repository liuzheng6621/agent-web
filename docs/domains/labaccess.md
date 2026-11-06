# 第六个域：研启・SciAegis（实验室预约平台）

真实后端：`D:\hos\appointment-check-in-system`（Spring Boot 3 + MySQL 8，151 个后端测试）。
适配器 `labaccess`，四条案例在 `cases/labaccess/`。

## 为什么挑它

前五个域的写入都是「你调接口，状态就变」。这个域不一样：**状态是被时间推着走的**。

- 预约有**时段**，时段有**容量**（容量满了第二次提交必须被拒）
- 时段**之外**取不到门禁口令——后端判的是 `startAt <= now < endAt`，早一分钟都不行
- 口令的**有效期被预约结束时间截断**（`expiresAt = min(now + TTL, endAt)`）
- 批准之后才发得出凭证；器材借出扣可借数、归还才恢复

`state_machine`、`window`、`relation` 三种断言在这里第一次有真对手。

## 跑起来

```bash
cd D:/hos/appointment-check-in-system
set -a && . services/backend/.env && set +a
"E:/java/IntelliJ IDEA 2025.1.1.1/jbr/bin/java.exe" -jar \
  services/backend/target/lab-access-backend-0.1.0-SNAPSHOT.jar --server.port=8182

cd E:/SKIl.1/agent-web
export LABACCESS_ADMIN_PASSWORD=$(grep '^APP_DEV_ADMIN_PASSWORD=' \
  /d/hos/appointment-check-in-system/services/backend/.env | cut -d= -f2)

node bin/agent-web.mjs probe  --adapter=labaccess
node bin/agent-web.mjs verify cases/labaccess --adapter=labaccess
node bin/agent-web.mjs certify cases/labaccess --adapter=labaccess
```

## 实测

| 命令 | 结果 |
|---|---|
| `probe` | 9 项：8 通过 / 0 失败 / 1 跳过（跳过项是「没有只允许部分角色的写能力」，给能力标了 `roles` 之后不再跳过） |
| `verify` | **4/4 与预期标签一致**，可判定率 100%，p50 ≈ 1.5s |
| `certify` | 抓到 3 / 适用 16 = **18.8%**，40 个变异体不适用（它们声明的是咖啡店/账本/词库的集合） |

## 适配这个后端时踩到的四件事

1. **时间必须是 `OffsetDateTime`**。`2026-11-07T01:30:18` 会被判「Request body is not valid JSON」——报错完全不像时间格式问题，实际是 Jackson 解析失败。必须带 `+08:00`。
2. **首登强制改密**。新建的学生/教师密码由管理员设，但带着它换来的 token 打任何业务接口都是 `403 PASSWORD_CHANGE_REQUIRED`。复位流程必须：登录 → `POST /api/v1/account/password` → **重新登录**（改密不会就地升级旧 token）。
3. **实验室要有开放时间**。不建 `openingHours` 时预约报 `LAB_NOT_AVAILABLE`「Reservation time is outside opening hours」。
4. **视图里不能放本轮专属的值**。`reset` 每轮都新建实验室与账号，把 `labId`、编号、账号名、绝对时间写进视图，复位幂等与无状态泄漏两项探针必红。现在视图只留 `capacity/status`、`status/purpose`、`totalQuantity/availableQuantity` 这些与身份无关的量。

## 一个真 bug（适配器自己犯的）

第一版 `execute(_runId, action)` 把第一个参数当成能力名，而契约是 `execute(runId, { capability, arguments, as })`——于是每条能力都落进 `default` 返回 `unsupported`，探针报「声明了的能力真的存在：失败」。

第二版更值得记：能力名取对了，但**忽略了 `action.as`**，永远用教师 token 去打审批。于是越权案例 `approve-forbidden`（学生自己批自己）**被判 pass**——学生确实"批准"成功了。这正是这个项目存在的理由：身份塌缩会让越权案例假通过。修法是 `tokenFor(as)`，让每步用自己的票。

## 还没做

- 只覆盖「预约—审批—口令」和「借用—批准—归还」两条链；课表导入、权限申报、设备事件、人脸登记都没接。
- 没有第二个实现，所以 `compare` 用不上——按 L11 的门槛（两个独立实现 + `compare` 100%），它**不算一个"验过的域"**，只算一次真实后端验证。台账里 L11 仍写五个域。
- 变异体只有 3 个能杀：会话窗口、审批越权、借还库存。**这个形状最该有的变异体还没写**（提前发凭证、容量不判、有效期不截断），它们要落在适配器层，不是后端层。

# 第六个域：研启・SciAegis（实验室预约平台）

真实后端：`D:\hos\appointment-check-in-system`（Spring Boot 3 + MySQL 8，151 个后端测试）。
适配器 `labaccess`，六条案例在 `cases/labaccess/`。

## 为什么挑它

前五个域的写入都是「你调接口，状态就变」。这个域不一样：**状态是被时间推着走的**。

- 同一间实验室的同一时段**只能有一条**有效预约，第二个人来约必须被挡回去
  （`ensureLaboratorySlotAvailable`：区间相交就抛 `RESERVATION_CONFLICT`）
- 时段**之外**取不到门禁口令——后端判的是 `startAt <= now < endAt`，早一分钟都不行
- 口令的**有效期被预约结束时间截断**（`expiresAt = min(now + TTL, endAt)`，`OTP_TTL = 5min`）
- 批准之后才发得出凭证，且**只有 pending 能被批准**（批过的再批一次要拒）
- 器材借出扣可借数、归还才恢复

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

node bin/agent-web.mjs probe   --adapter=labaccess
node bin/agent-web.mjs verify  cases/labaccess --adapter=labaccess
node bin/agent-web.mjs certify cases/labaccess --adapter=labaccess
```

`verify` / `certify` 必须带 `--adapter=labaccess`：不带就会退回默认适配器，
每条案例都报 `coverage_gap 能力 reservations.create 不在 manifest`——看着像案例坏了，
其实是尺子拿错了。

## 实测

| 命令 | 结果 |
|---|---|
| `probe` | 当时 9 项 8 通过 1 跳过（跳过项是「没有只允许部分角色的写能力」，给能力标了 `roles` 之后不再跳过）；v0.64.0 起探针是 12 项 |
| `verify` | **6/6 与预期标签一致**，可判定率 100%，p50 ≈ 1.4s |
| `certify` | 适用 8（四个本域 + 四个跨域通病）。v0.58.0 时抓到 7/20 = 35.0%，分母里掺了 13 个咖啡域老变异体；v0.63.1 补全 `applies_to` 后分母降到 8，但这一跑要先把 8182 后端起来 |

v0.63.1 之前 `certify` 的分母是 20，其中 13 个是咖啡域专用的老变异体，它们没声明
`applies_to`，工具只能按「适用」算，而它们在实验室适配器上连差异都造不出来。
补全声明后适用只剩 8 个：4 个本域专属（下一节）+ 4 个跨域通病（`m-no-reject`、
`m-exec-role-ignore`、`m-exec-duplicate-write`、`m-exec-drop-intermediate`）。
**这 8 个里没有一个能在这个域上被安全地判「抓住了」——除非后端在跑。**
后端不在时 certify 退 2 并明说「这一跑不成立」，不会印一个 0.0% 让人误读成「尺子不够长」。

## 六条案例

| 案例 | 钉住什么 |
|---|---|
| `reservation-approval` | 预约 → 批准，`count_delta` + 状态迁移 |
| `approve-forbidden` | 学生调教师审批端点必须被拒（身份塌缩的探针） |
| `slot-exclusive` | 同一实验室同一时段第二次必须被拒（时段排他） |
| `approve-twice` | 已经批过的再批一次必须被拒（批准是一次性的） |
| `otp-before-window` | 时段没到就取门禁口令必须被拒（时间窗） |
| `borrow-stock` | 借出两台时 `availableQuantity == 3`，归还后回到 5（中途 `window`） |

## 适配这个后端时踩到的四件事

1. **时间必须是 `OffsetDateTime`**。`2026-11-07T01:30:18` 会被判「Request body is not valid JSON」——报错完全不像时间格式问题，实际是 Jackson 解析失败。必须带 `+08:00`。
2. **首登强制改密**。新建的学生/教师密码由管理员设，但带着它换来的 token 打任何业务接口都是 `403 PASSWORD_CHANGE_REQUIRED`。复位流程必须：登录 → `POST /api/v1/account/password` → **重新登录**（改密不会就地升级旧 token）。
3. **实验室要有开放时间**。不建 `openingHours` 时预约报 `LAB_NOT_AVAILABLE`「Reservation time is outside opening hours」。
4. **视图里不能放本轮专属的值**。`reset` 每轮都新建实验室与账号，把 `labId`、编号、账号名、绝对时间写进视图，复位幂等与无状态泄漏两项探针必红。现在视图只留 `capacity/status`、`status/purpose`、`totalQuantity/availableQuantity` 这些与身份无关的量。

## 一个真 bug（适配器自己犯的）

第一版 `execute(_runId, action)` 把第一个参数当成能力名，而契约是 `execute(runId, { capability, arguments, as })`——于是每条能力都落进 `default` 返回 `unsupported`，探针报「声明了的能力真的存在：失败」。

第二版更值得记：能力名取对了，但**忽略了 `action.as`**，永远用教师 token 去打审批。于是越权案例 `approve-forbidden`（学生自己批自己）**被判 pass**——学生确实"批准"成功了。这正是这个项目存在的理由：身份塌缩会让越权案例假通过。修法是 `tokenFor(as)`，让每步用自己的票。

## 四个本域变异体（v0.58.0）

| 变异体 | 层 | 坏在哪 | 谁抓住它 |
|---|---|---|---|
| `m-lab-slot-conflict-ignore` | execute | 同一时段约两次都成功 | `slot-exclusive` 的 `expected_outcome: rejected` |
| `m-lab-otp-window-ignore` | execute | 时段没到就发口令 | `otp-before-window` 的 `expected_outcome: rejected` |
| `m-lab-approve-not-pending` | execute | 已批过的还能再批 | `approve-twice` 的第三个步骤 |
| `m-lab-borrow-stock-frozen` | state | 可借数永远等于总量 | `borrow-stock` 的 `window`（中途 3，终态 5 看不出问题） |

三个 execute 层的都靠**判决翻转**（该拒的变成成功）被抓住，`caseCaught` 记的是
`sig(base.verdict) !== sig(p.verdict)`；只有 `m-lab-borrow-stock-frozen` 是被具体断言杀死的。
换句话说：这四条案例里真正有杀伤力的断言只有 4 条（`armedAssertions 19 / usefulAssertions 4`），
其余 `count_delta` 和 `unchanged` 目前都是空转——它们该在别的变异体上发挥作用，不是在这儿凑数。

## 这个域验不到的东西：凭证有效期被截断

后端 `clampExpiry(now, OTP_TTL, reservationEndAt)` 把凭证有效期夹在预约结束时间之内。
写个「有效期不截断」的变异体很容易，但**当前案例模型抓不住它**，原因是结构性的：

1. 案例步骤只能是能力，**没有等待步**（`src/case.mjs` 里没有 wait/sleep）；
2. 后端要求 `startAt >= now` 才能建预约，而 OTP 只在 `startAt <= now < endAt` 内签发；
3. 于是「成功签发凭证」的状态在案例里根本走不到——所有 OTP 步骤都停在
   `ACCESS_WINDOW_INVALID`。伪造一个成功的 OTP 响应，观察里没有任何东西会变。

要抓它得先让案例模型能表达时间推进，或者让后端开放一个"签发但不校验窗口"的测试入口。
两条都不该为了一个变异体硬塞，所以这条暂记为盲区：**写进这里，而不是写一个永远漏网的变异体进目录**。
（顺带一提，「有效期 ≤ 结束时间」还缺一种有序比较断言：`relation` 只有 `eq/sum_equals/product_equals/sorted/sum_by_equals`，
`payload` 只有 `exists/equals/is_string/is_list/not_empty/count_gte/count_equals/contains`，都比不了两个时刻的先后。）

## 还没做

- 只覆盖「预约—审批—口令」和「借用—批准—归还」两条链；课表导入、权限申报、设备事件、人脸登记都没接。
- 没有第二个实现，所以 `compare` 用不上——按 L11 的门槛（两个独立实现 + `compare` 100%），它**不算一个"验过的域"**，只算一次真实后端验证。台账里 L11 仍写五个域。
- 本域适用 8 个变异体（四个 `m-lab-*` + 四个跨域通病）。v0.63.1 之前有 13 个老变异体没声明 `applies_to`，把分母灌到 20；补全后不再虚增（见 `docs/mutants/README.md`）。

# 定时任务调度域（cron）

第七个接进来的域，第六个**计入**的域（两个独立实现 + `compare` 100%）。

## 为什么挑它

前六个域里，时间是**标量**：预约有个时段、凭证有个有效期、发货有个时间戳。
比两个时刻的间隔，`timeliness` 做得很好。

但没有一个域能表达「**每隔 15 分钟必须跑一次**」。那不是一个时刻，是一串时刻：

- 少跑一个 → 报表缺一天
- 同一槽位跑两次 → 对账脚本把钱算两遍
- 每次晚 20 分钟 → 次数全对、时刻全错，下游全部错位

`count_delta` 只看总数，这三种坏法在它眼里都是「数量不对」。所以这个域一进来，
就逼出了第 20 种断言 `recurrence`。

## 两个实现，故意不同

| | 内部结构 | 游标怎么存 |
|---|---|---|
| `cron-a` | 数组 `runs` + 已完成槽位 `Set`（`${jobId}#${slot}`） | 存 `nextDue` 时间戳，逐槽循环补齐 |
| `cron-b` | `Map<slotKey, run>`（天然去重） | 只存 `lastSlot`，下次该跑的时刻现算 |

`compare --adapters=cron-a,cron-b` 实测 **3/3 判决一致、2 个集合逐字相同**。

## 能力（6 个）

| 能力 | kind | 角色 | 说明 |
|---|---|---|---|
| `job.create` | write | operator | 建任务；`everyMinutes` 约束 1..1440 整数 |
| `scheduler.advance` | write | operator | 把调度时钟推到某个时刻，沿途逐槽触发 |
| `job.pause` / `job.resume` | write | operator | 暂停期间不跑，恢复时**不补跑**欠下的槽位 |
| `jobs.list` / `runs.list` | read | operator, viewer | |

`reset_strategy: 'snapshot'`，`events_complete: false`。

## 三条案例

| 案例 | 验什么 | 断言 |
|---|---|---|
| `recurrence-full` | 24 个槽位跑满，一次不漏不重 | `count_delta` 25 · `recurrence` 25 槽 · `field_equals` nextDueAt |
| `recurrence-gap` | 暂停把时间线切成两段，每段各自跑满 | 两段 `recurrence`（4 + 3）· `count_delta` 7 · `unique` |
| `recurrence-drift` | 容差 60s 内允许晚到 | `recurrence`（tolerance 60s）· `unique` · `count_delta` 5 |

三条在 `cron-a` 与 `cron-b` 上都是 pass，`compare` 一致率 100%。

## 三个本域变异体

| 变异体 | 层 | 坏在哪 | 谁抓住它 |
|---|---|---|---|
| `m-cron-skip-slot` | state | 每第 4 个槽位静默漏跑 | `recurrence`（gap）+ `count_delta` |
| `m-cron-double-fire` | state | 同一槽位记录出现两次 | `recurrence`（duplicated）+ `unique` |
| `m-cron-drift` | state | 每个槽位都晚 20 分钟 | **只有** `recurrence` |

`m-cron-drift` 是关键那个：摘掉 `recurrence`，它从 `caught` 变 `killable`（有差异、没断言）。
`scripts/kind-necessity.mjs` 就靠它判 `recurrence` 是否必要——这是宪法第一条
「新增一种断言必须能杀掉至少一个变异体，且至少有一个只有它能杀」的现场证据。

`certify cases/cron --adapter=cron-a` 实测：适用 19、抓到 4（21.1%）、漏网 15。
漏网的 15 个全是咖啡域的老变异体（`m-breed-*` 等），它们没声明 `applies_to`，
在这个域上连差异都造不出来——**分母要打折看**。

## 这个域验不到的东西

**「异步回调改了状态」**。调度器只知道自己触发的槽位，不知道下游系统后来改了什么。
要验这一类，需要一种「外部事件改变了我的观察」的机制，那是 `docs/ROADMAP.md` 里
「异步回调」那一格，不是再加一个 cron 变体。

## 复现

```bash
node bin/agent-web.mjs verify cases/cron --adapter=cron-a
node bin/agent-web.mjs verify cases/cron --adapter=cron-b
node bin/agent-web.mjs compare cases/cron --adapters=cron-a,cron-b
node bin/agent-web.mjs probe --adapter=cron-a
node bin/agent-web.mjs certify cases/cron --adapter=cron-a
node scripts/kind-necessity.mjs
```

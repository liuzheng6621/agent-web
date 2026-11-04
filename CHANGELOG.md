# 变更记录

只记「做了什么」和「因为什么」，不记「感觉怎么样」。

**版本号唯一来源是 `package.json`。** 这份文件的第一条必须与它一致 —— `npm test` 里有一条用例在查，
CI 也在查。这条规则是买来的：这个仓库曾经同时存在 `package.json` 0.16、README 0.9、
Gitee Release v0.6.0 三个数，谁看都是三个项目。

## 0.27.0

- 第三个域：账本。`examples/ledger/` 是同一套规则的两个独立实现（整数分 vs 两位小数字符串、分录随交易存 vs 挂账户），`cases/ledger/` 四条案例两边判决一致，`compare` 视图契约逐字相同。
- 账本的正确性是不变量（借贷必须平衡），不是状态机——这是对断言词汇的一次换形状拷问。
- 变异体目录 19 → 22：`m-ledger-sign-flip`（负余额符号翻正）、`m-ledger-total-lies`（合计装平）、`m-ledger-any-balance`（不平也报成功）。账本域适用 5 个抓住 4 个。
- 变异体新增 `applies_to` 声明（能力 / 集合）：适配器没有它声明的东西就是「不适用」，不进抓获率分母。咖啡域 17/19，3 个账本变异体不再被误报成漏网。
- 公开一条词汇缺口：`unchanged` 只能断整段轨迹的初态对终态，「从被拒步之后不许变」表达不了（见 `examples/ledger/README.md`）。
- 内置适配器从 2 个变 4 个：`ledger-a` / `ledger-b`。

## 0.26.0

- 变异体从 16 个扩到 19 个，新加的三个都在执行层：`m-read-with-side-effect`（读也写）、`m-skip-intermediate`（两步压成一步）、`m-double-effect`（一次操作记两遍账）。
- 抓获率 14/16 → 17/19；三个新变异体分别只有 `unchanged`、`status_transition`、`count_delta` 抓得住，等于替这三种断言作证。
- 事故档案补两条：`k-login-rate-limit`（复位时每次重登撞上自己后端的登录限流）、`k-order-not-in-contract`（把实现自有的排序约定写成跨实现断言，造出一条假红）。

## 0.25.0

- `flow` 支持目录输入：一页判决总览——判决分布、可判定率、带锚点的案例目录，点目录跳到案例，正文照旧可展开。
- 单案例页面输出不变；新增 `buildDashboardModel` / `renderDashboardHtml` 导出与两条测试。

## 0.24.1

- README 补「判决长什么样：一个能打开的页面」：`flow` 的交互页面之前只在命令表里一行，
  现在有真实截图（playwright + Edge 对着生成的 HTML 截的，不是画的）和一张动图
  （点开被拒步看原因、一键筛偏差）
- 媒体登记进 tools/media/README.md：真实截图的取法（本地 http-server 绕过 file 协议限制）


## 0.24.0

- `discover` 的产物自带施工单：生成 `NEXT.md`（四处 TODO + 每步验收命令 + 常见坑清单），
  生成的 `adapter.mjs` 里四个待填位置直接标 `TODO(1)`–`TODO(4)`
  （能力表与角色 / 返回口径 / 规范视图 / 隔离），照着搜就能找到
- 输出的「下一步」一行指向施工单而不是三条裸命令
- 动机：接入自己网站从「读两份 300 行范例改四处」变成「跑一条命令后照单施工」，
  第三档（手写适配器，半天）的主要时间成本本来是「知道该改哪」


## 0.23.0



- 新增第二个领域案例：`examples/animal-tracking/`（流浪动物救助任务）。正确性全是不变量：未审核不可接取、非执行者不可完成、重复完成不可重复领积分。

- 真实 Spring 后端（一次性 H2）已实跑：verify pass、探针 6/6、跨适配器一致率 100%。

- 适配器安全边界：强制 `ANIMAL_TEST_ISOLATED=1` 显式确认、只接受无凭据的 loopback HTTP、没有默认目标。

- 新增 `docs/ADAPTER-GUIDE.md`：接到你自己的网站——三档路径（discover / 日志 / 手写适配器）与手写要改的四处（能力表、返回口径、规范视图、隔离）。

- 修了一个真实冲突：被测系统对登录接口限流，`reset()` 每次重新登录 admin 会触发 429把判决打成 unknown。admin token 现在按进程缓存，失效才重登。



## 0.22.0

第 1 条限制的能做的部分：`discover --writes`。

- 新增 `synthesizeBody()`：从 OpenAPI 的 `requestBody` schema 造一份「形状对」的请求体
  （字符串填 `x`、数字填 `minimum` 或 1、枚举取第一个、数组取一个元素、`$ref` 顺着
  `components.schemas` 解开）。造不出就返回 `null`，不编假的。
- 新增 `writePlanOf()`：只给 `POST` 到集合路径的 create 出计划。`delete` / `update`
  需要先有一条真实实体，探测阶段拿不到 id，硬编一个去打就是自己造的 404，所以不出。
- 新增 `buildWriteCases()`：每个 create 一条往返案例，断言只有
  `count_delta{collection, delta: 1}` —— 断「多了一条」，不断「内容对不对」。
  默认草稿，`--accept=名字` 才转正。
- 生成的适配器现在能真的发写请求（`sendWrite()`）：路径里的 `{id}` 从 `arguments` 取，
  body 优先用案例给的。没生成计划的写能力仍然返回 `unsupported`。
- `report.writeTodo` 把没生成案例的写接口连同原因列出来，不默默略过。
- 实测（同一批生成物，两个实现）：真写进去判 `pass`；回 200 但没写判
  `fail / assertion_false`，理由 `orders 变化 0（期望 1）`。这就是它能抓「接口假装成功」。
- 测试 164 → 170（discover 17 条，新增 6 条含一个起两台服务器的端到端对照）。

踩坑两条，记在这里免得下次再踩：`loadAdapter` 不吃 `file://` URL（当文件名解析），
测试里要传绝对路径；测试里 `server.close()` 会被 fetch 的 keep-alive 连接池挂住，
必须先 `closeAllConnections()`。

## 0.21.0

断言能说的，比「第 0 行等于 56」多。四种形状断言：`unique` / `type_of` / `subset` / `sorted_by`。

之前十二种里八种都在说同一件事：某一行的某个字段等于什么。真实系统最常需要的四句
——「这批 id 不重复」「总额是数字不是字符串」「状态只可能是这五个」「这个序列按时间排」
—— 没地方写。

每一种都过必要性检验（`scripts/kind-necessity.mjs`）：杀掉至少一个变异体，且有变异体
只有它能杀。为此专门写了四个变异体，每个都是照着「只有这一种断言能抓」设计的：
`m-duplicate-row`（覆盖成副本，条数不变，`count_delta` 抓不到）、`m-stringly-total`、
`m-status-off-enum`、`m-unsorted-orders`。

`sorted_by` 没进共享案例集。实测它在前端 mock 上成立、在真实后端上假红 —— 两边都没把
排序写进契约。挪到 `examples/shape-order/`，只对 mock 跑。这是第二个「能观测到不等于
值得断言」的例子（第一个是取餐号偏移）。

`pagination` 想过没收：规范视图不带分页元信息，写出来杀不掉任何变异体。

测试 151 → 164。README 限制第 7 条从「断言表达力有限」改成「分页仍然表达不了」。

## 0.20.0

变异体不再只靠人想。`agent-web breed` 从规范视图的形状生成，恒等算子自动跳过。

手写的十二个变异体是「我们想得到的」，想得到的总会用完。breed 换了个来源：观测到的字段
有什么类型，就照着这些位置造故障——数值差一/翻倍/丢两位，文本加前缀/转大写/置空，
集合丢尾/逆序。

生成不等于入库。新变异体要拿 `certify --mutants-dir=` 过一遍，杀不掉任何断言的照样落
`undetermined`。这是「断言要证明自己有用」的另一半：弹药管够，准入不变。

实测（memory 适配器，orders+menu 两个集合）：

复现命令：`breed --adapter=memory --from-case=cases/coffee/happy-path.json --out=.tmp-bred --max=40`
（`--max` 默认 24，超出会明说「另有 N 个没写」）。

- 28 个生成变异体，4 个恒等算子当场跳过（`'MAKING'.toUpperCase()` 还是 `'MAKING'`，
  `'拿铁'` 根本没有大小写——生成了只是把 undetermined 撑大）
- 全套 40 个变异体里抓到 38 个（95.0%），漏网 2 个：`m-pickup-no-offset`（偏移 100 是
  各实现自己的约定，跨实现断言不了）、`m-breed-reverse-menu`（菜单没有约定顺序，
  能看见差别但没有模板该表达它）
- 生成顺手补出两条真漏洞：`two-items` 少了明细菜品名的断言，`readonly-menu` 只钉住
  了第一道菜——第二个菜品被改成 `zz_美式咖啡` 时没人看得见

## 0.19.0

从一个网址开始。`agent-web discover <网址>` + `quickstart.sh`。

- 新增 `src/discover.mjs`：探站点根路径、试 8 个常见 OpenAPI 位置、把 `paths` 推成能力清单
- 生成一个**只读**适配器（能力全标 `evidence_level: inferred`），写能力一律 `unsupported`
- 每个资源生成一条案例草稿，断言只有 `unchanged`：读操作不该改变任何东西
- `--run` 把探测到的只读接口真的打一遍；带路径参数的标 `skipped`，不拼假路径去打（假失败比缺案例更坏）
- 新增 `quickstart.sh` / `quickstart.ps1`：一条命令走完探测到生成
- SPEC 新增第 15 章；README 新增「输入一个网址」；「现在做不到什么」第 1 条改为「写操作仍然要人写」
- 11 条测试（起本地 http 服务验证两条路径，不依赖外网）

为什么写操作不猜：看到 `POST /orders` 能知道「创建一个订单」，推不出「同一个人重复下单该不该被拒」。
前一句写在接口描述里，后一句是产品决策。猜出来的断言不许入库，这是判据准入的同一条规矩。

## 0.18.1 — 2026-11-04

### 修复
- `verify` 的 `--out` 不建父目录，CI 上第一次写 `.tmp-ci/traps.jsonl` 就 `ENOENT`。本地因为目录
  早就在了，永远看不到 —— GitHub Actions 因此连续 5 次红，失败步是「陷阱普查必须真的指得出盲区」。
- `two-items` 加了两个月没进 `expected.json`。`selftest` 只给它画一个「·」就退 0，`verify` 却判
  「1 条案例没有预期」退 1，于是凡跑 `verify` 的 CI 步骤全红。
- 徽章从 `shields.io` 与 GitHub Actions 换成本地 SVG（`docs/media/badge-*.svg`）。外部图源在 Gitee
  取不到，页面上是三块巨大的灰色占位方块。

### 新增
- `agent-web --version`／`agent-web version [--json]`：版本只有一处真相，CLI 直接读 `package.json`。
- 事故档案 `k-out-dir-assumed`、`k-case-without-expectation`。
- 本地测试 + CI 步骤：案例 id 集合与 `expected.json` 键集合必须完全相等。

## 0.18.0 — 2026-11-04

### 新增
- `knowledge/` 事故档案库：十条真实踩过的坑，每条必须带一个能跑的复现（`repro`）和一个已经落地的
  判据（`guard`）。只有一样的不收 —— 和 `certify` 的「杀不掉变异体的断言不许入库」是同一条宪法。
- `agent-web recall`：拿当前仓库去比对档案，命中了就说「你又要犯这个了」。默认按检测项 id 精确匹配
  （「总价算错」和「取餐号算错」结构相同、见证不同，不合并）；次数记在 `.agent-web/recall.json`，
  第二次命中直接退出 1 拦下来。
- 配图六件：`hero.png`、`loop.png`、`verdicts.png`、`demo.gif`、`recall.png`、`promo.mp4`，
  生成脚本在 `tools/media/`，依赖只有 Pillow 与 ffmpeg。
- README 从 781 行压到 163 行，长文移入 `docs/GUIDE.md`；`README.en.md` 同步。

## 0.17.1 — 2026-11-04

### 修复
- 建议断言给出 `id = 1` 这种一换实现就红的条目。加 `NON_PORTABLE` 字段集合与 `/(At|Time)$/`
  后缀规则；给不出建议时标 `suggestionBlocked` 并说明为什么给不出 —— 沉默会被读成没找到洞。
- 内置适配器的菜单自己编（「美式」对「美式咖啡」），案例在真实后端变成 `infrastructure_error`。

## 0.17.0 — 2026-11-04

### 新增
- `agent-web probe`：查适配器自洽性六项 —— 契约、复位幂等、观测稳定、无状态泄漏、空参不炸、
  写了要变（只警告）。「写了要变」故意不判死：发通知、写审计日志本来就不改规范视图。

### 已知不做
- `compare` 与 `certify` 保持串行。并发把真实后端从 77s 压到 8s，但结论会漂 —— 同一个变异体
  换一份建议断言，同一个案例换一条被判决级抓到的路径。这个工具卖的是结论，不是吞吐。

## 0.16.0 — 2026-11-04

### 新增
- 第八种断言 `relation`：`eq` / `sum_equals` / `product_equals` / `sorted`，只能用在终态相位。
- `src/relations.mjs` 关系发现器：先验证再提议，置信度分 `structural` 与 `coincidence`。

### 效果
- 判据准入从 8/12 到 11/12。关系式不是装饰：只留关系式、删掉写死金额，三个「漏乘/漏算」类
  变异体照样全被抓到。

## 0.15.0 — 2026-11-04

### 新增
- 漏网的变异体分三档：`caught` / `killable` / `undetermined`，并要求 `undetermined` 给出等价性证据。
  变异测试的等价变异体问题四十年没解决，不能假装解决了 —— 但也不能让它把基线表挂成一笔永远
  清不掉的账。
- `--suggest`：把「该补哪条断言」直接吐出来，且每条建议都当场在两个实现上验过。

## 0.13.0 — 2026-11-04

### 新增
- `agent-web drill`：把变异体变成可机器批改的题。出题三条前置（正确实现上 pass、坏实现上也 pass、
  故障在观测里看得见），缺一不出。判分只看断言在两个实现上的结果，不看提交怎么说。

### 效果
- 手写的好提交 100%，把原断言抄一遍的偷懒提交 0% —— 后者交的全是真断言，读代码看不出区别，只能跑。

## 0.12.0 — 2026-11-04

### 新增
- 变异体目录 `docs/mutants/`：清单开源、收稿有标准。第一个能被别人直接贡献的东西是这个目录。

## 0.11.0 — 2026-11-04

### 新增
- `agent-web certify`：判据准入。**抓不住任何变异体的断言不许入库。**
- 6 个变异体，抓 6/6，最小充分集 4 条。

## 0.10.0 — 2026-11-04

### 新增
- `agent-web traps`：这批判决有多少条在盲区里。实测盲区率 50%，五条案例只断言终态。

## 0.9.0 — 2026-11-04

### 新增
- `docs/museum/` 失败案例库：六件展品，每件都有一条「无机制时通过、有机制时被抓」的对照。

## 0.8.0 — 2026-11-04

### 新增
- `agent-web coverage`：能力覆盖率，用到的／声明没用的／要了没声明的强制分开。
- 加载外部适配器之前明确提示「这是可执行代码」—— 加载即执行，这一点不该被藏起来。

## 0.7.0 — 2026-11-04

### 新增
- 案例只存一份（删掉按实现复制的两份），草稿闸门（未经人确认的机器生成案例不许产生判决），
  `agent-web audit` 假绿审计（拿真实后端当尺子量候选实现）。

## 0.6.0 — 2026-11-04

### 新增
- `agent-web prepare`：从请求日志一次生成轨迹、案例草稿与流程预览。

## 0.5.0 / 0.4.0 / 0.3.0

- `flow`：案例与判决的流程可视化。
- `draft`：轨迹回放成案例草稿。
- `record`：把真实 Agent 流量还原成候选轨迹。绑定推断只认第一个产出者，认不出就跳过并说明原因。

## 0.2.0 / 0.1.0

- 三值判决 `pass` / `fail` / `unknown`，`unknown` 留在分母。
- 七种断言 × 相位矩阵、适配器五方法契约、规范视图、跨适配器判决一致率。
- 两套同构案例跑 mock 与真实后端；`foreign-pickup` 抓出一类假通过 —— 判的是案例说话，还是实现？

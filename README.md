<p align="center">
  <img src="docs/media/hero.png" alt="agent-web：给 Agent 写机器可判的集成测试" width="100%">
</p>

<h3 align="center">给 Agent 写的集成测试</h3>

<p align="center">
  一份案例，跑两个实现，判决必须一致。不一致的地方，要么实现有洞，要么断言在空转。
</p>

<p align="center">
  <img alt="node" src="docs/media/badge-node.svg">
  <img alt="dependencies" src="docs/media/badge-deps.svg">
  <img alt="license" src="docs/media/badge-license.svg">
  <img alt="tests" src="docs/media/badge-tests.svg">
</p>

<p align="center">
  <b>当前版本 0.28.1</b> · 12 种断言 · 24 条命令 · 22 个变异体
</p>

<p align="center">
  这一行不是宣传语，是 CI 逐项算出来的：版本号取自 <code>package.json</code>，断言种类取自 <code>KINDS</code>，
  命令数与变异体数取自代码本身。任何一处对不上，<code>scripts/status-line.mjs</code> 就会红。
</p>

---

## 它解决的问题

Agent 改代码改得很快，但「改对了没有」经常只能靠人肉点一遍。单元测试管不到跨请求的状态流转，端到端测试又慢、还不稳。

agent-web 的做法：把一次真实业务操作写成**案例**（做什么 + 结果该是什么），然后拿它同时打两个实现——一个内置的内存实现，一个你真实的系统。两边判决必须一致。

<p align="center">
  <img src="docs/media/loop.png" alt="一份案例，两个实现，一次对照" width="100%">
</p>

一致，说明案例可移植、断言没写死实现细节。不一致，就有一处要修，而且你能立刻知道是哪一处。

## 六十秒上手

<p align="center">
  <img src="docs/media/demo.gif" alt="终端演示：跑自测，再跑一次事故档案比对" width="100%">
</p>

不想读字的话，先看[四十二秒介绍片](docs/media/promo.mp4)。

```bash
git clone https://gitee.com/liu-everything_impossble/agent-web.git
cd agent-web
node bin/agent-web.mjs selftest          # 内置案例 + 内置实现，零配置
node bin/agent-web.mjs report results.jsonl
node bin/agent-web.mjs recall            # 比对事故档案：这次有没有重犯旧错
```

没有依赖，`node >= 20` 直接跑。想看它对你的服务怎么说：

```bash
node bin/agent-web.mjs certify cases/coffee --adapter=memory
```

## 输入一个网址

手上只有一台跑着的站点时，先别急着写适配器：

```bash
git clone https://gitee.com/liu-everything_impossble/agent-web.git
cd agent-web
./quickstart.sh http://127.0.0.1:8080
```

它做四件事：探这台站点通不通、有没有机器可读的接口描述（OpenAPI）、把探测到的只读接口真的打一遍、
生成一个能立刻跑的只读适配器、一批案例草稿，和一张施工单 `NEXT.md`。

要测写操作和业务规则，就照施工单把四个待填位置填掉——生成的 `adapter.mjs` 里每个位置都标了号
（搜 `TODO(1)` 到 `TODO(4)`：能力表与角色 / 返回口径 / 规范视图 / 隔离），每步的验收命令是现成的。
接入自己的网站从「读两份 300 行范例」变成「照单施工」。

```
探测 http://127.0.0.1:8199

  根路径  200  text/html  62 字节  演示订单服务
  接口描述  http://127.0.0.1:8199/openapi.json  演示订单服务 1.0.0

  探测到 6 个接口：只读 3，写 3
    R  menu.list                GET /api/menu
    R  orders.list              GET /api/orders
    W  orders.create            POST /api/orders

  实跑 3 个只读接口：
    OK    200 1ms    1 行     menu.list
    OK    200 2ms    2 行     orders.list
    SKIP  需要路径参数    orders.get  GET /api/orders/{id}
    2/2 可用，1 个需要参数没打
```

**它不猜写操作该保证什么。** 看到 `POST /orders` 能知道「会创建一个订单」，推不出「同一个人重复下单该不该被拒」
——前一句写在接口描述里，后一句是产品决策。所以生成的适配器对写能力一律返回 `unsupported`，
生成的案例只断言「读不改状态」，而且全是草稿，要 `accept --by=<你的名字>` 之后才出判决。

**加上 `--writes`，它能给 create 类接口生成一条往返案例。** 断言只有一句：写完之后那个集合多了一条。

```
  写案例（只断往返）：
    orders.create
  这些写接口没生成案例：
    orders.delete             DELETE /api/orders/{id}     需要先有一条真实实体（delete / update）
```

请求体从接口描述里的 schema 造（字符串填 `x`、数字填 1、枚举取第一个），只保证类型对、能让服务器收下。
断言断的是「多了一条」，不是「多出来的那条对不对」——后者要业务知识。
但就是这一句能抓到「接口回了 200 却什么都没写」：

| 实现 | 判决 | 理由 |
| --- | --- | --- |
| 真的写进去了 | `pass` | |
| 回了 `{"ok":true}` 但库里没动 | `fail` | `orders 变化 0（期望 1）` |

`delete` / `update` 不生成：探测阶段拿不到真实实体 id，硬编一个去打就是我们自己造的 404。

站点没有 OpenAPI 时它不瞎猜路径：猜出来的 404 会变成假失败，假失败比缺案例更坏。
那种情况它告诉你改走 `prepare`，先抓一次真实操作日志，从流量里还原。

## 判决只有三种

<p align="center">
  <img src="docs/media/verdicts.png" alt="pass / fail / unknown 三值判决" width="100%">
</p>

关键在 `unknown`：缺观测、缺能力、前置条件不成立的时候，它**不折算成 pass**，而是留在分母里。于是「测了多少」和「判了多少」是两件不同的事，指标里分别给：

```
可判定率 87.5% (7/8)   CI95[53%, 98%]
```

`unknown` 一多，可判定率就掉下来。这比一个漂亮的 100% 更能说明问题。

## 断言能说的，比「第 0 行等于 56」多

之前十二种断言里有八种在说同一件事：某一行的某个字段等于什么。真实系统里最常需要的
四句，反而没地方写：

| 断言 | 说的是 |
| --- | --- |
| `unique` | 这批行的 id 互不重复 |
| `type_of` | 总额是数字，不是 `"56"` |
| `subset` | 状态只可能是那五个值之一 |
| `sorted_by` | 这个序列按创建时间升序 |

它们断的是**集合的结构**，不是某一行的取值 —— 行号换了照样成立，所以比 `field_equals`
耐移植。

加这四种不是「顺手补全」，每一种都过了必要性检验：必须杀掉至少一个变异体，而且要有
一个变异体**只有它能杀**。

```
PASS  unique     只有它能杀：m-duplicate-row
PASS  type_of    只有它能杀：m-stringly-total
PASS  subset     只有它能杀：m-status-off-enum
PASS  sorted_by  只有它能杀：m-unsorted-orders
```

`m-duplicate-row` 是把最后一行覆盖成第一行的副本，**条数不变**。如果它只是多插一行，
`count_delta` 也会抓到，`unique` 就没有独占战功，那它不该存在。这条变异体是为这一个
问题写的。

`pagination` 想过，没收：规范视图不带分页元信息，写出来杀不掉任何变异体，是装饰。

**`sorted_by` 没进共享案例集**，理由是一条实测：

```
memory 适配器          → pass
真实咖啡店后端         → fail（第 0 行比第 1 行新）
```

两边都没把「列表按什么排」写进契约。这时断言升序抓到的不是 bug，是自己造的假红。
所以它挪到 `examples/shape-order/`，只对 mock 跑。

## 判据准入：一条断言要证明自己有用

断言写错了不会红。它会稳定绿——这是它最危险的地方。

`certify` 换了个问法：**这条断言能不能抓住故障？** 做法是造一批「每个都坏了一处」的实现（变异体），
然后看每条断言在**正确实现上成立、在坏实现上不成立**才算数。

<p align="center">
  <img src="docs/media/certify.gif" alt="判据准入：变异体是机器造的，判据也是机器判的" width="100%">
</p>

抓不住的变异体分三档，不许混在一起算：

| 状态 | 含义 | 该做什么 |
| --- | --- | --- |
| 抓到 | 有断言在坏实现上变假了 | 不用管 |
| 欠账 | 看得见差异，但没有断言抓它 | 补断言 |
| 说不清 | 连差异都造不出来 | 可能真等价，也可能案例没走到 |

第三种存在的原因是变异测试里那个四十年没解决的问题（equivalent mutant）。把它显式化，
比让它混在「漏网」里让基线表永远挂一笔清不掉的账要诚实。

它不只说哪里有洞，还说补哪条：`--suggest` 会从「正确实现和坏实现差在哪」反推出断言，
并且**当场在两个实现上各验一遍**才允许出现在报告里。

```bash
node bin/agent-web.mjs certify cases/coffee --adapter=memory --suggest
```

这几轮加上去的断言全部是它推出来的，不是我想出来的：

| 这一轮加了什么 | 抓到的变异体 |
| --- | --- |
| 起点：12 个手写变异体 | 8 / 12 |
| 关系式（`sum_equals`、`product_equals`） | 11 / 12 |
| 形状断言（`unique`、`type_of`、`subset`、`sorted_by`） | 14 / 16 |
| 执行层三个（读也写、跳步、双记账） | 17 / 19 |
| `breed` 自动生成变异体 | 38 / 40 |

反过来的检查也在跑：`scripts/certify-can-fail.mjs` 会把所有和总价有关的断言摘掉，
`certify` 必须立刻判红（实测漏网 5 个）。**一个永远不会红的检查不是检查。**

## 变异体不再只靠人想

手写的十九个变异体是「我们想得到的」。想得到的总会用完。

`breed` 换了个来源：看**观测到的形状**。字段是什么类型，就在那个位置造对应的故障——
数值差一、翻倍、丢两位；文本加前缀、转大写、置空；集合丢尾、逆序。

```bash
node bin/agent-web.mjs breed --adapter=memory --from-case=cases/coffee/happy-path.json --out=.tmp-bred --max=40
node bin/agent-web.mjs certify cases/coffee --adapter=memory --mutants-dir=.tmp-bred
```

生成不等于入库，判据和手写的完全一样：杀不掉任何断言的照样落 `undetermined`。

`--max` 默认 24（一次跑四十个变异体要几分钟）。超出上限时它会明说「另有 N 个超出 --max 没写」——不报的话，你会以为位置只有这些。

实测一次：

| | 数量 |
| --- | --- |
| 生成变异体 | 28 |
| 恒等算子当场跳过 | 4 |
| 全套 40 个里抓到 | 38（95.0%） |
| 漏网 | 2，两个都有明确理由 |

跳过的四个是 `'MAKING'.toUpperCase()` 还是 `'MAKING'`、`'拿铁'` 根本没有大小写——
改了等于没改，生成出来只会把 `undetermined` 撑大。**跳过也报数量**，不说的话读的人会
以为那里被覆盖了。

漏网的两个：`m-pickup-no-offset`（偏移 100 是各实现自己的约定，跨实现断言不了）、
`m-breed-reverse-menu`（菜单没有约定顺序，看得见差别但没有模板该表达）。

生成还顺手补出两条真漏洞：`two-items` 少了明细菜品名的断言，`readonly-menu` 只钉住了
第一道菜——第二个菜品被改成 `zz_美式咖啡` 时没人看得见。

## 出题与批改：标签由机制产出，不由模型

有了变异体，「谁对谁错」就不用模型来判了——**错的实现是造出来的，它错在哪是已知的**。

<p align="center">
  <img src="docs/media/drill.png" alt="出题与批改：标签由机制产出" width="100%">
</p>

`drill` 把每个（变异体 × 案例）配成一道题，题面写清楚坏在哪（`symptom`）、案例里现在有哪些断言，
但**不给 `catch_hint`，也不给变异体 id**。批改不看提交说了什么，只把它交的断言放到两个实现上各跑一遍：
正确实现上成立、坏实现上不成立，才算解出这题。

两份提交对照：

| 提交 | 成绩 | 为什么 |
| --- | --- | --- |
| 认真写的（`examples/drills/good`） | 3 / 3，exit 0 | 每条断言都只在坏实现上为假 |
| 把案例原有断言抄一遍（`lazy`） | 0 / 3，exit 1 | 交的全是真断言，读代码看不出区别，只能跑 |

第二份是这个设计的意义所在：它没有编造，它抄的是真实存在的断言，但那些断言看不见这个故障。

出题有三道前置，缺一不出：正确实现上本来就不红的（见证型案例）、已经能抓住的、
观测里看不见这个改动的——都不出题，而且分别记数，不是悄悄跳过。

## 判决长什么样：一个能打开的页面

命令行的判决是三行字。要看「每一步谁在执行、每条断言为什么是这个结果」，有一个双击就能打开的 HTML：

```bash
node bin/agent-web.mjs flow cases/coffee/happy-path.json --result=results.jsonl --out=flow.html
```

<p align="center">
  <img src="docs/media/flow.png" alt="flow 页面：判决、摘要、每一步的身份与结果" width="100%">
</p>

页面里每一步标着谁在执行（customer / staff）、结果是 applied 还是 rejected；
挂上判决结果后，每条断言的三值状态直接写在卡片上。步骤可以点开看参数，
「只看偏差」一键筛出所有与预期不符的步骤。

<p align="center">
  <img src="docs/media/flow.gif" alt="点开被拒的一步、再筛出偏差" width="100%">
</p>

上面这张动图是一条真实失败案例：跳过出餐直接取餐，第 3 步被后端拒绝
（期望 applied，实际 rejected），点开就是拒绝原因。HTML 自包含全部数据与样式，
file:// 直接打开，不需要服务器。
### 一页看全一个目录

给 `flow` 一个目录而不是单个文件，就得到总览页：顶部是判决分布（通过 / 失败 / 未知 / 可判定率），
下面是每条案例一行带锚点的目录，点哪行跳到哪条，案例正文照旧可展开。

```bash
node bin/agent-web.mjs verify cases/coffee --adapter=memory --out=results.jsonl
node bin/agent-web.mjs flow cases/coffee --result=results.jsonl --out=dashboard.html
```

<p align="center">
  <img src="docs/media/dashboard.png" alt="flow 总览页：判决分布 + 案例目录 + 每条案例正文" width="100%">
</p>

<p align="center">
  <img src="docs/media/dashboard.gif" alt="点目录里的任意一行，跳到那条案例" width="100%">
</p>

没传 `--result` 的案例按「未运行」显示，不会装作有判决。


## 事故档案

<p align="center">
  <img src="docs/media/recall.png" alt="agent-web recall 输出" width="100%">
</p>

`knowledge/` 里存着这个仓库自己踩过的八个坑。每条的入库条件是同一句话：

> 给不出复现、给不出判据的错误，不许入库。

所以每条都带最小复现命令和已经落地的检查项。`recall` 拿一次实跑的结果去比对：

- 第一次撞上 → 提示
- 第二次撞上 → **拦下来**（退出码 1，`--no-gate` 可放过）

```bash
node bin/agent-web.mjs knowledge     # 看全部十条
node bin/agent-web.mjs recall        # 扫一遍，看这次有没有重犯
```

「加深记忆」在这里是一个可验证的动作，不是权重：记的是次数，触发的是退出码。

## 命令一览

二十三条命令，按你手上有什么分三类。

**你有一个系统，想给它写测试**

| 命令 | 干什么 |
| --- | --- |
| `discover <网址> [--writes]` | 输入一个网址：探测接口、生成只读适配器与案例草稿；`--writes` 连 create 的往返案例一起生成 |
| `init <目录>` | 生成一份案例模板 |
| `prepare <日志>` | 从一次真实操作日志，一次生成轨迹、案例草稿、流程图 |
| `record <日志>` | 把请求日志还原成可回放的轨迹 |
| `draft <轨迹>` | 回放一条轨迹，反推案例草稿 |
| `accept <文件> --by=名字` | 确认草稿，确认后才能参与判决 |
| `verify <目录>` | 跑案例，出判决 |
| `report <jsonl>` | 出指标：可判定率、通过产出率、耗时 |
| `drift <旧> <新>` | 两份结果对照，看被测系统变了没有 |

**你有两个实现，想让它们互相对账**

| 命令 | 干什么 |
| --- | --- |
| `compare <目录> --adapters=a,b` | 判决矩阵 + 跨适配器一致率 |
| `audit <可信> <被审>` | 拿真实后端当尺子，量假绿和假红 |
| `probe --adapter=SPEC` | 先问一句：这个适配器有没有在撒谎 |
| `coverage <目录>` | 能力覆盖率：声明了没用上、用了没声明 |
| `traps <jsonl> --cases=目录` | 陷阱普查：这批判决有多少条落在盲区里 |

**你想验证「测试本身靠不靠谱」**

| 命令 | 干什么 |
| --- | --- |
| `certify <目录> --adapter=SPEC` | 判据准入：哪条断言真能抓住故障 |
| `certify --suggest` | 抓得住的故障，把缺的断言直接吐出来 |
| `mutants` | 变异体目录：实现能坏成什么样 |
| `breed --adapter=SPEC --out=DIR` | 照着观测到的形状自动造故障，恒等算子当场跳过 |
| `drill <目录> --out=DIR` | 出题：拿变异体当靶子 |
| `drill grade` | 批改：不看提交说什么，只看它杀了几个靶子 |
| `knowledge` / `recall` | 事故档案：记过的坑，第二次遇到拦下来 |
| `flow <案例> [--result=]` | 生成可双击打开的交互式判决页面（上一节那两张图就是它） |
| `selftest` / `capabilities` | 自测、能力清单 |

## 几个设计选择

**没有 LLM 判定。** 断言是十二种结构化谓词（`entity_exists`、`field_equals`、`count_delta`、`status_transition`、`unchanged`、`event_absent`、`relation`、`unique`、`type_of`、`subset`、`sorted_by`、`composite`），求值结果是三值逻辑。判决过程不调用模型，所以同一份输入永远给出同一个判决。

**适配器把观测投影成同一份规范视图。** 字段映射写在适配器里，不写进案例。换一个实现时案例一个字都不用改——这是跨实现对照能成立的前提。

**「谁来做」是案例的一部分。** 每一步都写明 `as: customer2`，runner 会检查适配器有没有真的换了身份。身份被悄悄塌缩成同一个人的时候，判决可能照样是 pass，但证据里看得出来。这个坑叫 `FINDING-001`，抓它的不是三值逻辑，是跨实现对照。

**建议断言必须当场验证。** `--suggest` 给出的每一条，都会在正确实现和变异体上各跑一遍，两边结果符合预期才允许出现在报告里。没验过的建议等于没给。

## 非咖啡领域：流浪动物救助任务

`examples/animal-tracking/` 给「守望者」后端准备了一条独立案例：居民提交救助任务 → 管理员审核 → 志愿者接取并完成。案例同时检查未审核任务不可接取、非执行者不可完成、重复完成不可重复领积分，以及 `PENDING → AVAILABLE → IN_PROGRESS → COMPLETED` 状态迁移。

先跑离线确定性夹具和业务变异体：

```bash
node bin/agent-web.mjs verify examples/animal-tracking --adapter=examples/animal-tracking/memory-adapter.mjs
node examples/animal-tracking/certify.mjs
```

要打到 animal 仓库的真实 Spring 后端，先在 `E:\\java\\Git\\加了\\animal\\backend` 启动一次性 H2 环境；不要对生产库或含真实数据的 MySQL 库运行。PowerShell 示例：

```powershell
mvn spring-boot:run "-Dspring-boot.run.arguments=--server.port=18080 --spring.datasource.url=jdbc:h2:mem:animal_agent_web_test;MODE=MySQL;DB_CLOSE_DELAY=-1 --spring.datasource.username=sa --spring.datasource.password= --spring.datasource.driver-class-name=org.h2.Driver --spring.jpa.hibernate.ddl-auto=create-drop --spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect --spring.mqtt.enabled=false"
```

另开 PowerShell，在 agent-web 仓库设置本地地址与该 H2 实例预置的管理员账号，再执行：

```powershell
$env:ANIMAL_TEST_ISOLATED = '1'
$env:ANIMAL_TEST_BASE_URL = 'http://127.0.0.1:18080'
$env:ANIMAL_TEST_ADMIN_USER = 'admin'
$env:ANIMAL_TEST_ADMIN_PASSWORD = 'admin123'
node .\\bin\\agent-web.mjs verify examples/animal-tracking --adapter=examples/animal-tracking/adapter.mjs
node .\\bin\\agent-web.mjs compare examples/animal-tracking --adapters=examples/animal-tracking/memory-adapter.mjs,examples/animal-tracking/adapter.mjs
```

真实适配器没有默认目标，强制要求隔离确认与 loopback HTTP 地址；每次 `reset` 会创建新的居民/志愿者账号并写入任务，H2 实例应是一次性的。



实跑结论（一次性 H2、2026-11-04）：案例 `pass`、探针 6/6、跨适配器一致率 100%。过程中修掉一个真实冲突：后端对登录接口限流，`reset()` 每次重登 admin 会撞 429 把判决打成 unknown——admin token 现在按进程缓存。

## 非咖啡领域：账本（借贷必须平衡）

`examples/ledger/` 是第三个域，跟前两个不一样：它不是接某个真实项目，而是**同一套规则的两个独立实现**。一份案例，两边的内部表示完全不同（整数分 vs 两位小数字符串、分录随交易存 vs 挂在账户上），`compare` 必须给出同样的判决和同一个规范视图。

```bash
node bin/agent-web.mjs verify cases/ledger --adapter=ledger-a
node bin/agent-web.mjs compare cases/ledger --adapters=ledger-a,ledger-b
node bin/agent-web.mjs certify cases/ledger --adapter=ledger-a
```

四条案例守四件事：平衡记账成功（总额恒为零、两账户一正一负）、借贷差一分必须拒、负数金额必须拒、未知账户必须拒。三个账本变异体（符号写反 / 合计装平 / 不平也报成功）被 certify 抓住两个，剩下一个靠负例步骤的判决级差异兜住。

它逼出来一条公开的词汇缺口：`unchanged` 只能断言「整段轨迹初态对终态」，表达不了「从被拒的那一步之后不许变」——详见 `examples/ledger/README.md`。

## 现在做不到什么

按离真实使用最近排序。

1. **写操作仍然要人写。** `discover` 能把探测到的只读接口直接变成可跑的适配器；`--writes` 能给 create 生成往返案例（写完多了一条）。但「写进去的内容对不对」「该不该允许」仍然要人写 —— 它不知道你的业务该保证什么。另外适配器是代码，`load` 会直接 import 它，加载适配器等于以你的身份执行它；CLI 会提示一次，那不是沙箱。
2. **字段映射靠人写。** 规范视图的映射是有意放在适配器里的，没有自动推导。
3. **只判合法性，不判质量。** 能说「这个流程合法」，说不出「这个流程走得好不好」。评价质量要引入打分，那是另一个东西。
4. **负例得人补。** `draft` 会把该写负例的地方列成待办，写不了：负例的判断标准是「应该允许什么」，照着实际发生的写等于当场放水。
5. **变异体可以机械生成，但只能生成「想得到的形状」。** `breed` 照着字段类型造故障，差一、翻倍、置空这类覆盖得了；「这个业务规则压根没实现」覆盖不了。手写那份清单仍然要人补。
6. **等价变异体问题没有解决。** 只是把它变成了显式状态：杀不掉但造得出差异 → 欠账；连差异都造不出 → 说不清，要求给出证明。
7. **分页仍然表达不了。** 十二种谓词覆盖了唯一性、类型、值域、顺序，但「第 2 页且按时间倒序」这种带分页元信息的约束还是写不出来 —— 规范视图不带页码。
8. **适配器可以撒谎。** 裁剪过的观测、假装的执行，`probe` 只能查六项机械性质，查不出故意造假。它保证的是「给定这份观测，判决是这么来的」。
9. **跨域验证仍然太少。** 两个真实后端（咖啡店、动物救助）加一个自造双实现账本域；但「三个」离「形状足够多样」还差得远，而且账本域是我们自己编的，证据强度低于真实项目。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/GUIDE.md](docs/GUIDE.md) | 完整说明：每条命令的细节、判决顺序怎么来的、踩过的坑怎么修的 |
| [docs/ADAPTER-GUIDE.md](docs/ADAPTER-GUIDE.md) | 接到你自己的网站：三档路径与手写适配器要改的四处 |
| [docs/SPEC.md](docs/SPEC.md) | 格式规范：案例、断言、适配器契约、判决顺序表 |
| [docs/FINDING-001.md](docs/FINDING-001.md) | 一次假通过的全过程 |
| [docs/museum/](docs/museum/) | 六件失败展品，每件都能复现 |
| [docs/mutants/](docs/mutants/) | 十九个变异体，收稿标准在 README 里 |
| [docs/media/promo.mp4](docs/media/promo.mp4) | 四十二秒介绍片 |
| [CHANGELOG.md](CHANGELOG.md) | 每个版本做了什么、因为什么 |

## 许可

MIT。案例、变异体、事故档案都欢迎投稿——它们的价值本来就在数量上。

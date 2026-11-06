# 变更记录

只记「做了什么」和「因为什么」，不记「感觉怎么样」。

**版本号唯一来源是 `package.json`。** 这份文件的第一条必须与它一致 —— `npm test` 里有一条用例在查，
CI 也在查。这条规则是买来的：这个仓库曾经同时存在 `package.json` 0.16、README 0.9、
Gitee Release v0.6.0 三个数，谁看都是三个项目。

## 0.51.0

第 19 种断言 `state_machine`：不是「走过哪些态」，而是「**只许走这些边**」。

`status_transition` 只能断言「某条边出现过」。它说不出「不许从 PENDING 直接到 PICKED」——
那句话不是关于出现过的边，而是关于所有**可能被走**的边。

- **`transitions` 必须显式声明**：不给就 `unknown/not_declared`。没声明就没约束，判真等于假装查过了。
- **`states` 可选**：观测到未声明的状态 → `unknown/unknown_state`，不判假——那是声明漏了一个态，不是实现走错了。
- **`walk` 两种取序列方式**，因为状态机在两个地方都成立：
  - `snapshots`（默认）：跟某一个实体在每一步快照里的状态走（订单从下单到取餐）。
  - `rows`：把流水集合自己当序列，每行取 `path` 那一列（「事件日志只许按这四条边走」）。快照里只看第一行会漏掉追加在末尾的边。
- **独占杀手 `m-illegal-transition-allowed`**：在最后一个快照的 `status_log` 末尾追加一条 `PICKED→MAKING`。四条声明的边一条不少，`status_transition` 照样判真，只有「只许走这些边」这句话能发现它。`kind-necessity` 实测：能杀 3 个（`m-history-empty`、`m-duplicate-event`、`m-illegal-transition-allowed`）。
- `certify` 口径：47 个变异体、12 条案例、适用 32、抓到 30（93.75%），欠账仍是 `m-pickup-no-offset` 与 `m-unsorted-orders`。

## 0.50.0

P3 align 下钻：容器配上了，里面的字段也要配——同时补上「语义重叠必须人签」的检测。

- **下钻**：`items → lines` 之前只配容器，元素里的 `count → qty`、`unitPrice → unitRate` 全靠人肉。现在对配上的数组字段各取元素画像，用同一套打分与同一道门槛再配一遍，键形如 `items[].count → lines[].qty`（两侧前缀各自用自己的容器名，不共用参照的名字）。
- **歧义检测 `ambiguous`**：两个源字段都自信地指向同一个目标字段（`count` 与 `quantity` 都指向 `qty`），一个都不配，全列出来要求人签。这条比错配检测更要紧——错配还能靠「有另一个名字更像」发现，语义重叠只能靠冲突发现。
- **取值完全一致且唯一 → 采纳**：名字毫无关系、元素行又少时分数卡在 0.65 上不去（`dishName → label` 就是），但取值多重集完全一致且该源字段只有一个这样的目标是这里能拿到的最强证据。**只对非数字生效**：数字撞车太常见（28 既是单价也是小计），「取值一样」在数值上不构成身份证据。
- **比率分母修正**：分母 = 顶层字段 + 真正下钻过的元素字段。只算顶层会让比率超过 100%（20 / 17 → 117.6%）。
- 两个夹具实测：改名夹具 **21/21 = 100%**、硬夹具仍是 17/21 且零错配（`totalAmount` 与 `pickupNo` 留给人签）。

## 0.49.0

P2 elicit：把「写操作要人写」降到「人签」——边界输入现在由**声明**派生，而且跑出来给你看。

- **契约新增可选 `constraints`**：`{min, max, integer, enum}`，键是参数路径（支持 `items[].qty` 这种数组通配）。声明非法（min>max、空约束、不认识约束项）在 `validateManifest` 就报错——半份约束比没有约束更危险，工具会按它派生边界。
- **内存适配器先声明一条真的**：`order.create.constraints['items[].qty'] = {min:1,max:99,integer:true}`，与 `execute` 里那道 `qty 必须是 1..99 的整数` 对齐。
- **`negatives` 新增候选类型 `boundary_violation`**：只试声明过的边界（`min-1`、`max+1`、非整数、枚举外值），没声明就一条都不造——不猜。
- **`negatives --run`**：把候选真的跑一遍，按**最后一步的结局**分四类：`observed_reject` / `observed_accept` / `diverged` / `unknown`。**不看整体判决**——负例本来就会让案例自带的 goal 断言不成立，拿整体判决分类等于在测「我把断言改坏了吗」。
- **`--second=SPEC`**：同一候选在两个实现上都跑，结论不同记 `diverged`（契约没说清，先别写案例）。
- **候选仍是 `disputed`**：观察到的事实不是判据，进 `cases/` 仍要 `accept --by` 署名。审阅表多一栏「实测」，汇总多三行。

实测（`negatives cases/coffee --adapter=memory --run`）：12 条案例、189 条候选，实跑后 `按期望被拒 150 条 / 实际执行成功 39 条`。那 39 条里 `role_violation` 全部落在 `customer → customer2`——内存适配器把 `customer2` 声明成**身份别名**而不是角色，这是清单的问题不是实现的洞，已在候选的「待确认」里写明这条。

## 0.48.1

快路径与重放路径的一处语义分歧（CI run #77 在「快路径必须与重放逐格相同」那步红的）。

- **现象**：`scripts/state-equivalence.mjs` 报 `happy-path.json m-drop-create-event 判决不同：重放 unknown/missing_observation 变换 pass/ok`。
- **根因**：`deriveVerdict` 只检查「有没有断言变假」，没检查「有没有断言看不见」。变异体删掉 `order.created` 之后 `timeliness` 找不到起点事件 → 该断言 `unknown`；重放路径按「有 unknown 就整体 unknown」判，快路径却因为「没有 false」判成 pass。两条路径对同一条案例给出不同判决，等于同一份证据两个结论。
- **修法**：`deriveVerdict` 在「无 false」之后先查 `unknown`，有则返回 `unknown` + 该断言的 `code`。语义与重放路径对齐：**pass 的前提是所有断言都成立，看不见不算成立**。
- **连带**：`test/certify.test.mjs` 里「缺了金额与流水断言的案例会漏掉两个变异体」那条，剥断言时要把 `timeliness` 一起去掉——它读 `status_log`，留着它删流水只会变 `unknown`，测试的立论就不成立了。
- `m-shipment-late` 没有 `tamper`（只改 `observe` 返回），快路径复现不了它，退回重放；这是边界，已在变异体文件里写明。

## 0.48.0

第 18 种断言 `timeliness`：用真实时间戳判「多久之内必须做完」，这是步号坐标永远说不出来的事。

- **为什么必须新开一种 kind**：现有 17 种都在「第几步」这个坐标上。`window` 能说「第 2 步到第 3 步之间状态没变」，说不出「发货必须在付款后 24 小时内」——后者需要事件时间戳、时钟来源、时区、缺时间与边界比较语义，这些都不能用步号替代。
- **三条硬边界写在代码里**：事件没时间戳 → `unknown/missing_observation`（看不见不等于做错了）；没声明时区 → `unknown/missing_timezone`（不猜）；**恰好等于上限算成立**（「24 小时内」包含 24 小时）。
- **独占杀手 `m-shipment-late`**：`observe` 时把 `order.picked` 那行的 `at` 推后 25 小时，状态与顺序一字不动。`scripts/kind-necessity.mjs` 实测「能杀 1 个 / 只有它能杀 m-shipment-late」——没有这条断言它就会漏网。
- **`certify` 口径**：46 个变异体、12 条案例、适用 31、抓到 29（93.5%），欠账仍是 `m-pickup-no-offset` 与 `m-unsorted-orders` 两条。
- 时长写法支持 `ms/s/m/h/d`（`24h`、`90m`、`5000ms`、`2d`）；时间戳支持毫秒数与 ISO 字符串。

## 0.47.0

P0：把台账里「说的是不是真的」修掉，并把探针从六项补到九项。

- **L5 的数字由脚本生成**：`scripts/certify-baseline.mjs --emit-limits` 输出「45 个变异体，12 条案例，适用 30，抓到 28（93.3%）」。台账里原来写着「22 个变异体、抓到 17（89.5%）」——**那是漂掉的**，`test/limits.test.mjs` 现在比对这一行与实测，手写的数字再也混不过去。
- **探针补三项**：`declared-vs-behavior`（声明了却回 unsupported）、`role-effective`（忽略 `as` 就能绕过）、`read-no-side-effect`（读偷偷写）。反向验证用 `test/fixtures/lying-adapter.mjs`：三处谎同时犯，三项全红、退出码 1；内置适配器九项全过。
- **台账每条验收命令都要是真命令**：`test/limits.test.mjs` 扫 LIMITS 里的 `node bin/agent-web.mjs <子命令>`，必须在 `--help` 里存在。
- **L11 写清计数判据**：`cases/realworld` 只有一份实现，没有 `compare`，因此不计入四个域——这样「几个域」不再靠人数。
- **L8 的措辞改准**：不是「需要进程隔离」，而是「仍可撒谎，隔离未做」。

## 0.46.0

RealWorld 的 13 个官方 hurl 套件转出的案例，从 **pass 3 / fail 9 / unknown 1** 变成 **13/13 全绿**，并进 CI。

- **能力名推导按路由位置取参数**：`PUT /api/articles/some-slug` 里 `some-slug` 是字面量 slug，早期实现把整段当成资源名，推出 `some-slug.update` 这种不存在的能力。现在 `articles/` 第二段一律识别为 slug，字面量与 `{{slug}}` 走同一条路。
- **token 变量名不等于身份**：`updated_token` 是同一个人换了张票，早期实现把它当第二个人，于是「改自己的资料」被判成越权。
- **夹具补上业务语义**：`favorited` / `following` 按当前用户算，`feed` 按 following 过滤，401 回 `{errors:{token:['is missing']}}`、越权回 `forbidden`、评论到不存在的文章回 `{errors:{article:['not found']}}`、重复注册 422/409 与契约一致。
- **新增 CI 步骤**：起夹具 → 跑 `verify cases/realworld --adapter=realworld`，证明「转换器 + 适配器 + 夹具」三者仍然自洽。
- `examples/realworld/README.md` 与中英 README 的状态口径同步改写：13/13 只证明三者自洽，不证明某个 RealWorld 实现是对的。

## 0.45.0

第四个验证域：词库检索。加它不是为了「再一个业务」，是为了补一个前三个域都没有的**数据形状**——
900 条结果、每页 10 条翻三页。它当场抓出了分页断言自己的一个盲区。

- 新增 `cases/lexicon/` 四条案例：翻页（`pagination` + `sorted_by` + `unique`）、
  查不到应被拒绝、分词结果逐字相等、结构约束（`unique` / `type_of` / `subset` / `sorted_by`）。
- 新增两个实现 `examples/lexicon/adapter-a.mjs` 与 `adapter-b.mjs`：
  A 用字典树 + 正向最长匹配，B 用排序数组二分 + 反向 DP。**算法真的不同**，
  否则 `compare` 的一致率是自证而不是契约。`src/adapter/load.mjs` 注册为 `lexicon-a` / `lexicon-b`。
- 数据是合成的（`examples/lexicon/dataset.mjs`）：30 个音节两两组合 900 条，
  每个字段由下标决定。不从公开词库搬数据——那些多半没有明确许可证，搬进来等于把授权问题
  写进本仓库的 LICENSE。合成数据是纯函数产物，判决指纹不漂。
- **修了 `pagination` 的一个真盲区**：它只把各页行数加起来跟案例声称的 `total` 比，
  从不读实现自己报的 `total`。于是「命中 30 条、每页 10 条翻三页正好 30 条、但 `total` 写着 900」
  在每一页都满的情况下全绿——而这正是分页最常见、后果最直接的坏法。
  新增 `pagination_total_reported`，在数行数**之前**先比报数（先指出报数错，才不会误报成丢行）。
  兼容 `{total}` 与 `{data:{total}}`；实现没报这个字段就跳过。
- 新增 9 个词库域变异体：`m-lexicon-page-drop` / `-total-lies` / `-duplicate-id` /
  `-strokes-as-text` / `-unsorted` / `-category-out-of-enum` / `-segment-truncate` /
  `-lookup-empty-object` / `-segment-echo`。目录总数 36 → 45。
  词库域适用 16 个，抓住 10 个（62.5%），最小充分集 6 条断言。
- 新增 `test/lexicon.test.mjs`（17 条）：不只校验案例合法性，还**守住这个形状本身**——
  数据集少于 500 条、翻页案例不足三页、`total` 不够三页，都要红。
- 限制 L11 从「三个域」改为「四个域」，并写清仍然缺的三种形状（长事务、多租户、异步回调）。
  顺手修掉一个既存漂移：总表 L11 写 `continuous`、正文写 `ongoing`，而 `continuous` 根本不在
  五值词表里。`test/limits.test.mjs` 新增守卫：总表与正文的 status 必须逐条一致。
- 限制章节的两层各司其职：上层列「已经有代码和测试守着」的能力，下层**只写没解决的部分**。
  原先下层有 5 条开头把上层说过的事又复述一遍（「`align` 已给建议」「`negatives` 已能派生」
  「步号区间…关联已有」「算法和台账已接通」「判决指纹门已就位」），读下来只剩一个疑问：
  这节到底在说做了还是没做。新增守卫：下层 11 条里不许出现完成态措辞。
- 英文 README 的域表格补上词库那一行（上一版只改了标题「four domains」，表格还是三行 ——
  标题说四个、下面列三条，读者第一反应是这份文档不可信）。
  新增守卫：标题里的域数、表格数据行数、中英两版行数，三者必须相等。

## 0.44.0

负例不再只留一句「得人来补」：`negatives` 从声明派生候选，但不替你决定期望。

- 新增 `agent-web negatives <案例或目录> --adapter=SPEC`：按清单声明派生五类候选——
  必填参数缺失、角色越权、类型不符、主键指向不存在实体、重复提交。
- 每条候选带 `basis`（哪条声明支持它）、`confidence`、`review`（人要想清楚的问题），
  全部 `status: disputed`；只写 `.agent-web/negatives/` 下的 JSON + Markdown 审阅表，
  **从不写进案例目录，也从不进判决**。
- 重复提交只给 `applied` / `rejected` 两个假设，不自带期望：幂等与否声明里没有，
  这一条只能由业务决定。
- 派生轨迹的最后一步会被改写成 `expected_outcome: rejected`，避免出现「审阅表说该拒绝、
  轨迹却写着该成功」的自相矛盾；`test/negatives.test.mjs` 有守卫。
- `docs/LIMITS.md` 的 L4 从 `open` 改为 `mitigated`；文档同时写明仍未解决的部分：
  非法状态迁移需要状态机声明，候选转正仍要人署名 `accept`。
- 顺手修掉 `docs/GUIDE.md` 里写死的旧版本号与缺失的 `align` 命令条目。

### 判决确定性门（L9 的可运行那一半）

L9 一直只有一句散文「恢复前要证明串行与并行逐字一致」，没有机器门。补上：

- 新增 `src/determinism.mjs` + `scripts/verdict-determinism.mjs`：把判决压成指纹
  （`status` / `reason_code` / `stage` / 每条断言的序号·kind·三值·代码 /
  每一步的 capability·身份·期望结局·实际结局·错误码），逐条比对并指出差异路径。
- `npm run determinism` 同进程连跑两遍；`determinism:baseline` 存基线，
  `determinism:check` 与基线比 —— 后者才是串行 vs 并行的门。
- 默认不比时间戳（真实后端每次都不一样，比了这扇门永远是红的、人就会去关它）；
  `--strict` 额外比 `detail` 与 evidence 摘要。
- 形状借自 DeepInfer 的 `tests/models/test_batch_invariant.py`：不比「输出文本一样」，
  比 token_ids + logprobs + top-k 逐位相同。结论一致不等于过程一致。
- `test/limits.test.mjs` 的开关守卫从「裸词匹配」改成「剥掉注释后再找」：
  注释里提一句 k04 不再判红，字符串里真写了开关仍然判红。
- 反向验证：篡改基线里一条 `status` 后 `determinism:check` 退出码 1 并指出
  `reason_code` / `status` 两处漂移；恢复后退出码 0。

### 预检（跑之前就知道会不会有结论）

`unknown` 以前只有跑完才拿到，但其中一大半是静态可知的。新增
`agent-web preflight <案例> --adapter=SPEC`：拿清单的声明对账，预测
`ready` / `unknown` / `fail` 三类，并与 `expected.json` 的标签比对。

- `unknown`：能力未声明、断言引用的集合不在视图契约、事件类型不在词表。
- `fail`：某个「期望成功」的步骤用了能力不允许的身份 —— 那一步必然被拒。
- 负例故意用错身份不算问题，只看 `expected_outcome: applied` 的步。
- 行尾 `!` 表示预测与预期对不上，退出码 1；仓库里故意写坏的案例不算问题。
- 形状借自 DeepSpeed 的 `ds_report`：`installed` 与 `compatible` 分两列，
  「没装 ≠ 不兼容」。这里同理，「清单里没有」和「有但观测不到」不合成一个数。

实测：咖啡域 12 条 → ready 10 / unknown 1 / fail 1，全部与预期自洽；
拿咖啡清单去预检动物域，4 条全部报警并指出缺失能力。
反向验证：去掉「只看期望成功的步」这个条件，负例身份豁免那条测试转红。

### 判决确定性门（L9 的可运行那一半）

L9 一直只有一句散文「恢复前要证明串行与并行逐字一致」，没有机器门。补上：

- 新增 `src/determinism.mjs` + `scripts/verdict-determinism.mjs`：把判决压成指纹
  （`status` / `reason_code` / `stage` / 每条断言的序号·kind·三值·代码 /
  每一步的 capability·身份·期望结局·实际结局·错误码），逐条比对并指出差异路径。
- `npm run determinism` 同进程连跑两遍；`determinism:baseline` 存基线，
  `determinism:check` 与基线比 —— 后者才是串行 vs 并行的门。
- 默认不比时间戳（真实后端每次都不一样，比了这扇门永远是红的、人就会去关它）；
  `--strict` 额外比 `detail` 与 evidence 摘要。
- 形状借自 DeepInfer 的 `tests/models/test_batch_invariant.py`：不比「输出文本一样」，
  比 token_ids + logprobs + top-k 逐位相同。结论一致不等于过程一致。
- `test/limits.test.mjs` 的开关守卫从「裸词匹配」改成「剥掉注释后再找」：
  注释里提一句 k04 不再判红，字符串里真写了开关仍然判红。
- 反向验证：篡改基线里一条 `status` 后 `determinism:check` 退出码 1 并指出
  `reason_code` / `status` 两处漂移；恢复后退出码 0。

## 0.43.0

`witness` 现在看每一步，不只看终态——「中途坏、结尾修好」这一类终于能被看见。

- 新增 `traceDiff(a, b)`：逐步对比 `trace[i].stateAfter`，见证路径形如 `trace.3.adoption_applications.0.status`。
- `driftPaths` 同步覆盖每一步（两次重放之间本来就会变的字段，不能拿来当见证）。
- `trace.*` 的见证照实报出，但**不给建议**：步号只对这一条案例成立，要断言它得用 `window` / `every_step`，
  不是把步号写进 `field_equals`。
- 效果：`m-approval-autoapprove` 在动物域从「说不清」变成「欠账（2 处可观测差异）」，
  补一条 `window from_step:0 to_step:1` 的断言后变成「抓到」（`adoption-submit-reject#goal[4]` 独占）。
- 上一次失败的原因也写进文档：用 `every_step` 圈整条案例会把「本人撤回后变 REJECTED」判成违约，
  区间要卡在提交之后、撤回之前。

## 0.42.0

动物域补一条业务层变异体，顺带修掉一个让断言跑到「上一轮数据」上的真 bug。

- `m-approval-autoapprove`（把所有 PENDING 申请直接改成 APPROVED）：本域实测被判 **说不清**——
  两条案例都没断言「提交之后到审批之前一直是 PENDING，且没有 reviewer」。不删这个变异体：
  留着它每次 certify 都会把这个洞报出来，补法写在 `docs/domains/animal.md`。
- **修 `src/adapter/animal.mjs` 的陈旧索引**：这个后端不清理历史数据，`observe` 原来暴露
  `/api/v1/adoptions` 的全部历史行，于是案例里的 `index 0` 指的是**上一轮跑出来的那一行**，
  断言一直在别人的数据上判真。改成 reset 时记下本轮开始前的最大申请 id，`observe` 只暴露之后新增的行。
- 顺带：`certify cases/animal` 的适用范围判定现在会给出「不适用 23 个」的准确数字，
  而不是把咖啡店集合的变异体混进分母。

## 0.41.0

L5 第二刀：账本域两条业务层变异体，其中一条当场逼出一个新算子。

- `m-dup-credit-entry`（把每笔交易的贷方分录复制一条）——**第一次跑是「欠账」**：交易条数、描述、`total` 全不变，
  现有五条断言一条都看不见，因为账本案例只校验「各账户余额」，从不校验「分录自己平不平」。
- 于是 `relation` 补一个算子 `sum_by_equals`：`{selector:{collection}, op:'sum_by_equals', leaf:'entries',
  field:'amount', group_field:'direction', left:'debit', right:'credit'}` —— 同一集合里两组行的字段之和必须相等。
  借贷平衡就是这条。加进 `ledger/post-balanced.json` 后，`#goal[5]` **只杀 `m-dup-credit-entry` 一个**。
- `m-unbalanced-accepted`（把 `transaction.post` 的拒收改成成功）：被 `reject-unbalanced` 等负例的
  `count_delta`/`unchanged` 以「判决级 ×3」抓住。

## 0.40.0

L5 第一刀：`breed` 不再硬编码集合名，执行层变异体补三条。

- `src/breed.mjs` 导出 `collectionsOf(manifest)`；`breedMutants` 未显式指定集合时先问适配器要
  （`manifest.view.collections` 的键），读不到才退回 `orders/menu/status_log`。
  realworld → `articles,tags,comments`，animal → `animals,adoption_applications,…`。
- 三条执行层变异体：`m-exec-role-ignore`（把 `action.as` 换成 manifest 第一个角色）、
  `m-exec-duplicate-write`（写成功后同参再写一遍）、`m-exec-drop-intermediate`（第一次迁移类调用改成空操作）。
- **第一次写它们时全被判「抓到」是假阳性**：`wrapExecute(inner, patch)` 的 `patch` 收的是 **action**、
  返回打补丁后的 action，我按「收 (result, runId, action) 返回结果」写，结果把整条流水打断，
  于是每条断言都「抓到」——那种抓到毫无信息量。改成自己实现 `{...inner, execute}` 之后，
  命中点变具体：`m-exec-duplicate-write` 只被 `count_delta` / `linkage` 抓到
  （`happy-path#goal[3]`、`linkage-events#goal[0]`、`paged-orders#goal[1]`）。

## 0.39.0

`linkage` 补上数量关系：存在性说得清「有没有」，说不清「多了几条」。

- `expect.count` + `expect.count_op`（`equals` / `at_least` / `at_most`）：一行 A 对应的 B 行必须正好 / 至少 / 至多几条。
  违反时报 `linkage_count_violated`，消息里写实际条数与期望。
- 新变异体 `m-duplicate-event`：把第一条 `order.created` 复制一份塞回去。**存在性断言照样通过**，
  只有 `coffee/linkage-events#goal[2]` 这条数量断言抓得住（顺带也抓到 `m-double-effect`）。

## 0.38.0

补上 L7 最后一项：跨实体约束。

- 新增第 17 种断言 `linkage`：`凡是 A 里的行，B 里都必须有对应的那条，且它的某个字段必须是什么`。
  参数是 `from{collection,where}` + `to{collection,on{from_field,to_field}}` + `expect{field,op,value}`，**只能终态**。
- 边界写死：对侧缺那一行是**违反**（`linkage_missing`）而不是「看不见」——两个集合都读到了，
  只是对应关系不存在，记成 unknown 会让这个断言永远抓不到故障。看不到集合、一行都没匹配上、
  参数不全才判 `unknown`。
- 新变异体 `m-drop-create-event`：订单建了，但审计流水里那条「已下单」被删掉。
  只有 `linkage` 抓得住它，同时它也顺手抓掉 `m-history-empty` 与 `m-extra-foreign-order`——
  以前这三条得靠三条不同断言，现在一条跨实体约束全包。
- 新案例 `coffee/linkage-events`。踩坑记录：`wrapState` 的 tamper **必须原地改 state**，
  写成 `const s = clone(state); return s;` 等于什么都没做（包装器不看返回值），第一次跑出来是「说不清」。

## 0.37.1

把 RealWorld 的 13 个 hurl 套件全量转进来，并把「转得动」与「跑得绿」分开说。

- 转出 **13 条案例 / 157 步 / 296 条 `payload` 断言**，94 处转不成断言的进同名 `.todo.md`。
- 能力名推导修两处：末段是动作词（`login`/`follow`/`favorite`/`feed`）时资源取前一段；含变量的字面量段（`some-slug-{{uid}}`）算参数不算资源名。
- 路径参数按**位置**定名：`/articles/{{slug}}/comments/{{id}}` 的第一个是父资源 slug，第二个才是评论 id。
- 身份只由「注册/登录时提交的用户名」决定，**token 变量名不算身份**——同一套件注册一次再登录一次会捕获 `reg_token`/`token` 两个名字，把变量名当身份会让后半段以陌生人的身份执行。
- `examples/realworld/README.md` 记实测：**pass 3 / fail 9 / unknown 1**，十条红按六类归因（夹具文案、缺字段、鉴权字段、多身份、计数口径、状态回读）。
- `cases/realworld` **不进 CI**：`expected.json` 写的是目标标签而不是实测，这条红线留着当进度条。

## 0.37.0

把 RealWorld 的现成断言套件真的跑起来：`src/adapter/realworld.mjs` + `examples/realworld/fake-server.mjs`。

- **新适配器 `realworld`**（19 个能力，注册在 `src/adapter/load.mjs`）：覆盖 users/user/profiles/tags/articles/comments/favorite。
- **新夹具 `examples/realworld/fake-server.mjs`**（零依赖内存实现，`--allow-reset` 开夹具复位口）。
- **`payload` 断言支持 `value_from`**：期望值可以是「前面某一步返回体里的位置」，例如先建一条再翻页找它。
  现成套件里这种写法很常见，不支持就只能把它当字面量、白白丢掉一半断言。
- **转换器修了七处会让案例假红的地方**：路径参数按资源定名（`slug`/`id`/`username`）；注册与登录步归属
  `user` 角色（否则新 token 记在 anonymous 名下）；`[Captures]` 引用写成返回体路径（`$s2.article.slug`）；
  查询串进实参（`limit`/`offset`/`author`）；变量占位符改成 JSON 安全的 `@@x@@` 并递归替换数组；
  `null` 实参不再被丢掉（`{"bio": null}` 就是清空）；`GET /a/{x}/b` 这类末段是复数的按 `list` 而不是 `get`。
- 实测：`probe` 6/6；`verify cases/realworld` **3/3 与预期一致**（夹具在 8299）；测试 **257/257**。

## 0.36.0

「案例从哪来」这个问题，现在有一个不靠猜的答案。

- **新增 `payload` 断言（第 16 种）**：读的是**返回体**，不是规范视图。`{kind:'payload', step, path, op, value}`，`op ∈ exists/equals/is_string/is_list/not_empty/count_gte/count_equals/contains`。视图里没有 token、没有分页信封，这些断句以前只能丢。
- **新增 `m-payload-truncate`**：执行成功后把返回体里每个顶层数组砍掉一行——状态没坏，只有响应体坏。`scripts/kind-necessity.mjs` 量过：**只有 `payload` 这一种能杀它**。
- **新增 `agent-web import hurl`**：把 hurl 套件转成案例草稿（不联网、不执行）。请求 → 步、`[Captures]` → 捕获、`[Asserts]` → `payload` 断言；**读不懂的写进同名 `.todo.md`，不猜**。
- 拿 RealWorld 的三套件实测：**31 步 / 74 条断言 / 0 处待办**（auth 20 步 60 答、pagination 7 步 8 答、tags 4 步 6 答）。
- 为什么是 hurl 而不是 Postman/Bruno：纯文本、有捕获与断言段、断言词汇小，正好对得上 `payload`；而且 RealWorld 这类语料自带一整套。

## 0.35.0

第三个真实域：流浪动物保护追踪系统（Spring Boot 3 + MySQL），形状刻意选得跟咖啡店处处不像。

- 新增 `src/adapter/animal.mjs`（内置名 `animal`）：Spring Page 信封摊平成规范视图，大写状态，三个真实账号（admin/volunteer/user），token 缓存在 `.agent-web/animal-tokens.json` 绕开登录限流（登录每分钟限流一次）。
- 新增 `cases/animal/` 四条案例：领养申请提交→驳回、越权驳回必须被拒、动物列表翻页、设备号查询与不存在的动物。
- **域内第一个 fail 是真的**：`PUT /api/v1/adoptions/{id}/approve|reject` 只要求「已登录」，任何用户都能审批。实测用 `user` 的 token 批准了一条自己的申请，库里那一行 `reviewer=user`。案例判 `fail expected_rejection`「adoptions.reject 应被拒绝，实际被执行」。
- `certify cases/animal`：抓到 1、欠账 1、**不适用 23**（变异体声明的是咖啡店的集合，不进分母）。跑完约 90 秒。
- 新增 `test/domain-animal.test.mjs` 五道离线门：案例合法、案例与预期标签一一对应、三角色互不相同且 `events_complete=false`、越权案例必须用非管理员身份、不允许出现 `approve`（这个后端没有把 `status` 改回去的接口，用一次案例就变一次性）。
- 新增 `docs/domains/animal.md`：跑法、四个缺陷（F1 无角色检查 / F2 驳回无状态护栏 / F3 status 过滤没生效 / F4 points 500）、以及「为什么 23 个变异体不适用」。

## 0.34.1

一条命令忽略了自己的参数，报出的数字不是它说的那个东西。

- **`selftest --adapter=taixianglian` 一直跑的是内存适配器**：`cmdSelftest` 写死了 `makeAdapter('memory')` 与 `adapterName: 'memory'`，`flags.adapter` 从头到尾没被读过。于是「真实后端也一致」这个结论从来没在真实后端上量过。修完后第一次跑出真实数字：10/10，与内存适配器一致 —— 但这次是真的。
- **`taixianglian` 适配器的 `order.list` 吞掉了翻页参数**：写死 `page=0&size=50`，于是「翻三页」的案例在真实后端上拿到三份一样的第一页。现在 `page` / `pageSize` 真的转发（后端是 0 基，适配器减一），并回 `page`/`pageSize`/`total`/`hasMore`。
- **`pagination` 的顺序检查改为「方向一致」而不是「升序」**：内存适配器升序、真实后端按 id 倒序，升降序是各实现自己的约定，案例不该写死。真正的不变量是页与页之间方向不翻 —— 第一页降序、第二页升序，正是翻页丢 `ORDER BY` 的症状。`m-page-shuffle` 照样被抓。
- 新档案 `k-ignored-flag`（第 15 条）+ `test/cli-flags.test.mjs` 守卫：用一个「一被加载就抛错」的桩适配器证明 `--adapter` 真的改变了被加载的实现。
- 实测：`paged-orders` 在内存适配器与真实后端**都 pass**；`certify` 22/24 = 91.7%；`npm test` 239/239。

## 0.34.0

分页：单看每一页都好的四种故障，终于有断言管了。

- **新断言 `pagination`**：把几个翻页步的**执行返回**拼起来查四件事——跨页重复（含同一页内重复）、非末页不满页、几页加起来不等于 `total`、按页次拼接后排序字段不单调。数据来自 `trace[i].payload`，不是规范视图：视图是整份状态快照，一条翻过页的列表在视图里和没翻过一模一样。
- **`memory` 适配器的 `order.list` 支持 `page` / `pageSize`**，并回 `page` / `pageSize` / `total` / `hasMore`。
- **修掉一个真 bug**：`order.list` 原来在**规范视图**上按 `ownerId` 过滤，而视图里只有 `username` ⇒ 顾客的订单列表恒为空（只有店员看得见全部）。之前没有案例用过 `order.list`，所以一直没露。改成在原始状态上过滤再投影。
- **三个新变异体**，全部只在返回体上动手、不碰状态：`m-page-duplicate`（第二页重复上一页末行）、`m-page-drop`（每页少给尾行）、`m-page-shuffle`（第一页内部倒序）。视图不变，所以只有 `pagination` 能杀——`scripts/kind-necessity.mjs` 现在验七种。
- **两处基础设施要跟着改**：`probe` 的 ctx 现在带 `trace[i].payload`（录制适配器记下每次执行的返回，证据里的 trace 仍然不夹带业务数据）；`transformCtx` 快路径重建 trace 时只换 `stateAfter`、其余字段原样带过（早先丢了 `payload`，分页断言在快路径上恒 `unknown`，是等价性门把它抓出来的：`重放[true,true,true,true] 变换[true,true,unknown,true]`）。
- 新案例 `coffee/paged-orders`：五单、每页两条翻三页。`certify` 现在 **22/24 = 91.7%**（27 个目录、3 个不适用），仍漏 `m-pickup-no-offset`、`m-unsorted-orders`。

## 0.33.1

让需要步号的变异体说实话。

- CI 的「快路径必须与重放逐格相同」红了：`m-transient-menu-price` / `m-mid-write-leak` 靠 `tamper(state, index)` 里的下标下药，
  而 `wrapState` 的 `observe` 包装拿不到步号 —— 慢路径根本没注入故障，于是重放看到正确实现、变换看到坏实现。
- 处理：这两个变异体标 `requires_trace: true`，`scripts/state-equivalence.mjs` 跳过它们并**把跳过的数量与名字打出来**。
  不是把门关掉，是把边界说出来。

## 0.33.0

断言从 12 种到 14 种：补上「时间窗」和「每步求值」——这两种不是更严格，是换个观察口。

- **`window`**：把观察缩到 `[from_step, to_step)` 这一段，内层只能是 `unchanged` / `count_delta` / `field_equals` / `entity_exists`。
  对付「被拒绝之后留了半条流水，收尾时又抹掉」：净变化为零，`unchanged` 判真。
- **`every_step`**：每走完一步就用「起点 → 这一步之后」重跑内层断言，任何一步假就假，并指出第几步。
  对付「中途抖一下又改回来」：终态干净，`unchanged` 判真。

两种都只允许停在 `trace` 相位——写成 `final` 等于把窗口丢掉，校验期直接拒。

配套两件必须一起做：

- `transformCtx` 现在把 `(state, index, count)` 交给变异体，才能只坏「中间那一步」而不碰首尾。
- 新增 `m-transient-menu-price`、`m-mid-write-leak` 两个变异体，各自**只被一个新 kind 抓住**：
  `scripts/kind-necessity.mjs` 扩到六种，且时序两条改用仓库里的真案例（`skip-ready-stage` / `happy-path`）来测，
  不拿手编的迷你案例冒充。

还没做：`pagination`（跨页重复 / 边界丢行 / 翻页乱序 / total 说谎）需要 `observe` 带分页元信息，
`docs/LIMITS.md` 的 L7 仍是 `open`，没有假装解决。

## 0.32.0

跨命名体系的字段映射：`agent-web align`（L2）。

- 输入两份规范视图，输出建议映射 `align.yml`：`mapping` / `confidence` / `unresolved` / `accepted`（空，等人签）。
- **五路信号，权重固定**：名字（复数归一到同义词组，四档不连续）、逐行取值一致、取值多重集一致（行序不同也能认）、枚举重合、基数一致；类型不同直接出局。
- **低置信度一律不猜**（< 0.75 进 `unresolved` 并给 top-3 候选）。宁可说不清，也不许错配——错配会让案例在一个「看起来对、其实错」的字段上判 pass。
- **集合级硬证据**：两份集合的叶子值多重集逐字相同（改名级重构的典型特征）直接给 0.95，名字像不像都不重要。
- 验收夹具（`test/fixtures/align/`）：纯改名 17/17 字段、3/3 集合、**零错配**；狠的那份（行被打乱、`totalAmount` 改成 `x9`、`pickupNo` 被删、`event` 改成 `category`）恢复 15/17、**零错配**，剩下两条如实进 `unresolved`。
- 已知边界：嵌套数组只映射容器，内部字段不判（`items` → `lines` 会配上，里面的 `qty` 要等下钻）。

## 0.31.0

出题台账：把「这次答了几题」变成「跨批次可比」。

- 新增 `src/drill-ledger.mjs`：`drill grade --record[=FILE]` 追加 `.agent-web/drills.jsonl`，`drill stats` 出统计。台账只追加，不改写历史。
- **只存机制能证明的东西**：题号（`case@mutant`）、状态、每个断言的判定格（killed/survived/blind/unarmed）、提交指纹。不存提交内容，也不存 `detail`——台账是用来算难度的，不是用来收集答案的。
- 提交指纹是对**批改结果的形状**取哈希，不是对提交文本取哈希：同一份提交重跑指纹相同，但仍然留不下任何一行答案。
- `drill stats` 给 Wilson 95% 区间。11/11 不再显示成「100% 稳了」，而是 `100.0% [74.1%, 100.0%]`。
- 难度分层 `easy` / `medium` / `hard` / `insufficient_data`，**每题至少 5 次批改才算数**；样本不够时明说不够，不分层。
- `drill --order=empirical`：按台账里的经验难度出题，难的在前，没测过的排在后面。
- 理由：4/5 与 40/50 不是同一件事；不给区间就等于假装知道精度。

## 0.30.0

把「现在做不到什么」从散文变成台账，并修掉两条自相矛盾。

- **第 9 条曾写成「并发已做但有限，`--jobs` 只并发案例级」——代码里没有 `--jobs`。** 并发在 `k04` 里被撤回了（串行 77s → 6 并发 8s，但同一变异体从「被第 4 条断言抓住」变成「判决级 ×3」）。已改为「并发被撤回了」并指向 k04。
- **`drill` 题面只列 7 种断言**，而 `KINDS` 有 12 种：`relation` / `sorted_by` / `unique` / `type_of` / `subset` 从没告诉答题人能用。现在是 `KINDS` 插值 + 按相位矩阵分组，`test/drill.test.mjs` 加守卫。
- 新增 `docs/LIMITS.md`：L1–L11 每条带 `status`（open / mitigated / by-design / withdrawn / continuous）、验收命令、为什么不解决。
- 新增 `test/limits.test.mjs` 三道门：中英 README 各 11 条且与台账一一对应；每条必有 status 且取值受限；L9 撤回后代码里不许再出现 `--jobs`。

## 0.29.4

删掉 `badge-tests.svg`。

那个数字只能手动跟，`status-line` 查不到它——上一版就停在 129，实际已经 187。留一个必然过期的数字比没有这个徽章更糟：读者无法分辨它是真的还是忘了改。`status-line` 现在守的四个值（版本、断言种类、命令数、变异体数）都是算出来的，徽章区只留同样是恒定事实的三枚。

## 0.29.3

配图和用法整体重做——之前文字更新了，图还停在旧版本。

- `terminal.png`、`demo.gif`：从「selftest + recall」改成现在的真实链路 `selftest → tap → learn`；`recall.png` 重渲到 14 条档案。
- `promo.mp4`：42 秒的 v0.18 版作废，重做 52 秒七幕（判决三种 / 输入网址 / 录五分钟流量 / 断言准入 17-19 / 出题批改 11-11 / 结尾），脚本 `tools/media/8-promo.py`。
- `certify.png`：数字换成当前的 22 个变异体、17/19、89.5%，并加一行「分母在变，四张牌不能直接比大小」。
- `drill.png`：3/3 换成 11/11（22 题、`--allow-missed`）。
- `badge-tests.svg`：129 → 187。
- README 中英「六十秒上手」改为先 `selftest`，再看 `quickstart.sh <网址>`，并说明 `quickstart` 就是 `discover` 加三条提示。
- `docs/GUIDE.md` 里两处版本号（0.19）跟到 0.29.3。

## 0.29.2

- 修 CI 第 21 步（出题与批改）：`examples/drills/good` 只覆盖 22 道题里的 11 道，而这一步要求「好提交必须满分」，于是一直红。
- 根因不是批改器：建议断言只能表达「集合内某个字段的取值差」，整实体替换与集合外差异表达不了。硬凑满分只能靠人写那 11 道题的答案。
- 于是拆成两条校验：默认「必须答满」，`--allow-missed` 是「答了就必须对」（没答的照实报，答错/交不上来的仍然失败）。CI 用后者，参考答案由 `scripts/drill-reference-answers.mjs` 从已验过的建议断言生成。
- `examples/drills/good` 换成按当前题集生成的那 11 份（每份都当场验过：正确实现 true、坏实现 false）。

## 0.29.1

- 修 CI 连续三次红：状态行脚本要求 git tag 里有 `v<当前版本>`，但发版的正常顺序是先推 main、CI 绿了再打 tag —— 这个合法中间态被算成漂移。现在缺当前版本 tag 默认只提醒，发版流程用 `--require-tag` 变回硬错。
- 这一条进了事故档案（`knowledge/k14-tag-intermediate-state.mjs`）：判据本身没错，错在把"顺序中间的合法状态"当成"自相矛盾"。本地全绿、CI 全红是这个坑的典型症状。

## 0.29.0

- 新增 `agent-web tap`：反向代理录一段真实流量（不是脚本，是「应用说过什么」）。正文里的口令/token/会话一律换成 `password#1` 这类稳定伪名，明文不进录制文件。
- 新增 `agent-web learn`：从录制里长出四样东西 —— ①声明式适配器 `adapter.yml` ②回放孪生 `twin.json` ③案例草稿 ④`unclassified.jsonl`（认不出的形状）。全部 `evidence: inferred`，案例默认草稿，得 `accept` 才出判决。
- 新增声明式适配器（`src/adapter/decl.mjs` + `src/yaml.mjs`）：一份 yaml 描述登录、能力、视图投影、状态码归类，不用写代码。`{items:[…]}` 这类包裹自动认出来。
- 新增回放孪生适配器（`src/adapter/twin.mjs`）：同一个案例同时打真实系统和孪生，`compare` 100% 一致、视图契约逐字相同 —— 孪生是白送的第二个实现。
- 验收四段全部达成：干净服 pass、孪生 pass、两适配器一致 100%、改坏应用**不重录**必须红（实测 `count_delta`「tasks 变化 2（期望 3）」）。
- 这一轮修掉的坑都带教训：`Object.keys()` 对 `Map` 恒返回空（集合检测因此全灭）、每个动作按路径末段取集合名会把 `{items:[…]}` 认得只剩一行、空数组被当成"没有这个集合"。
- 诚实边界：只支持单角色链路（多角色要按 per-token 伪名反查会话，未做）；录制没走到的故障抓不到——这是案例没走到，不是工具失灵。

## 0.28.1

- 修 `--help` 漏掉四条命令：`discover` / `mutants` / `audit` / `traps` 一直在代码里分发，但帮助文本没列。外部读者（包括别的模型）照着帮助判断项目有什么，会得出"还很早期"的结论——这已经真发生过一次。
- 帮助文本不再手写清单：断言种类插值自 `KINDS`，事故档案条数插值自 `ENTRIES.length`。新增 `test/help.test.mjs`，从源码里把「分发的命令」和「帮助里列的命令」抽出来比对，两边必须完全一致。
- `agent-web --help` 退出码从 2 改成 0；不带任何参数才是 2（用法错误）。
- README 顶部加一行机器算出来的状态：版本 / 断言种类 / 命令数 / 变异体数。`scripts/status-line.mjs` 逐项从代码里算并比对，对不上就红；CI 在跑。起因是外部读者把旧文档读成了"0.1 阶段、7 种断言"。
- 这一版没有新能力，全部是让"仓库对外说的话"和"仓库里真的有的东西"对齐。

## 0.28.0

- certify 不再重放 state 层变异体的整条轨迹：直接用正确实现的 ctx 变换求值。真实后端上 2.95×（3 条案例 44.5s → 15.1s），memory 域无可测差异。执行层（换身份、改结局）仍然真重放。
- 等价性不是声称的：`scripts/state-equivalence.mjs` 逐案例 × 逐 state 变异体对比两条路径的断言结果、判决签名、初态与终态视图，135 组 0 处不一致，已进 CI。
- 修一个存在已久的错：certify 把漂移当见证。同一条案例跑两遍，自增 id、时间、取餐号本来就会变，此前这些差异被算成「变异体被看见了」。真实后端上 `m-duplicate-row` 的见证是 `orders.0.id` 从 196 变成 210，还会据此建议写 `orders.0.id == 196`（对照 `k-unportable-assertion`）。现在每案例先跑两遍正确实现求出漂移集，再从见证里剔除。
- 副作用是诚实的：真实后端上「欠账」变少、「说不清」变多——原先那几条本来就没有真凭据。
- SPEC 新增 12.10（快路径与等价性论证）、12.11（漂移不是见证）。

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

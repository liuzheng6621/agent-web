# 限制清单（L1–L11）

README 的「边界：已实现与仍未解决」是这份清单的摘要。**两边条目必须一一对应**：数量不等、
编号对不上、或某条在 README 里被删掉而这里还留着，`test/limits.test.mjs` 会红。

这份文件存在的理由很直接：第 9 条曾经写成「并发已做但有限，`--jobs` 只并发案例级」，
而代码里根本没有 `--jobs`——并发在 `k04` 里被撤回了。靠人记一定会漂，所以让机器查。

## 状态词

| status | 意思 | 能不能算「待办」 |
|---|---|---|
| `open` | 确实没做，且有明确做法 | 是 |
| `mitigated` | 有降级路径，但没根治 | 是（但不必现在做） |
| `by-design` | 不打算解决，解决它会伤到别的东西 | 否，这是设计边界 |
| `withdrawn` | 做过、撤了，原因记在事故档案 | 否，已付过学费 |
| `continuous` | 只能靠不断加域来验，没有终点 | 否，按需推进 |

## 总表

| # | 限制 | status | 验收命令 |
|---|---|---|---|
| L1 | 写操作的语义仍然要人给 | `mitigated` | `node bin/agent-web.mjs discover URL --writes` |
| L2 | 字段映射靠人 | `mitigated` | `node bin/agent-web.mjs align test/fixtures/align/ref-view.json test/fixtures/align/renamed-view.json` |
| L3 | 只判合法性，不判质量 | `by-design` | 见 L3 正文 |
| L4 | 负例得人来补 | `mitigated` | `node bin/agent-web.mjs negatives cases/coffee --adapter=memory` |
| L5 | 变异体仍有盲区 | `mitigated` | `node bin/agent-web.mjs breed cases/coffee --adapter=memory` |
| L6 | 等价变异体问题没有解决 | `by-design` | `node bin/agent-web.mjs certify cases/coffee --adapter=memory` |
| L7 | 断言表达能力仍有缺口 | `mitigated` | `node scripts/kind-necessity.mjs` |
| L8 | 适配器可以撒谎 | `open` | `node bin/agent-web.mjs probe cases/coffee --adapter=FILE` |
| L9 | 并发被撤回了 | `withdrawn` | `npm run determinism`；开关守卫见 `test/limits.test.mjs` |
| L10 | 难度标签只是统计 | `mitigated` | `node bin/agent-web.mjs drill stats --min-attempts=5` |
| L11 | 只在四个域上验过 | `ongoing` | `node bin/agent-web.mjs compare cases/<域> --adapters=A,B` |

## L1 写操作的语义仍然要人给

`status: mitigated`

`tap` + `learn` 能录到「应用答应过什么」，于是写操作不必从零手写；`discover --writes`
能推**往返语义**（建一条 → 列表里出现 → `count_delta +1`）。剩下真正要人的是业务规则：
「库存不足该拒绝」「退款不许超过实付」。录不到，只能人补断言。

没有做的事：从 `capabilities[].args` 与 OpenAPI 约束自动生成边界输入（0、-1、超库存、缺字段、
错角色），在正确实现与孪生上各跑一遍，产出候选规则让人 `accept`。这条路可行，
但必须默认标 `disputed` 而不是直接写进案例——机器观测不许冒充人的期望。

## L2 字段映射靠人

`status: mitigated`

`agent-web align` 现在能把「跨命名体系的字段映射」变成提议 + 人签：纯改名夹具 17/17 字段、
3/3 集合、零错配；行被打乱且字段被改成毫无关系的名字时，恢复 15/17 且**零错配**，
剩下两条如实进 `unresolved`。

仍不解决的是：**嵌套数组只映射容器**（`items → lines` 配得上，`count → qty` 要等下钻）；
以及**同一字段在不同集合里语义不同**（订单的 `amount` 是总额，账本的 `amount` 是单笔）——
这需要按语义而不是按取值分布来判，当前不猜。

验收：`node bin/agent-web.mjs align test/fixtures/align/ref-view.json test/fixtures/align/renamed-view.json`。


## L3 只判合法性，不判质量

`status: by-design`

「这条流程走得好不好」需要打分模型，那就把要解决的问题搬回来了。能数的是步数、重复读、
绕路次数、无用重试——计数不是评分，可以进 `report`，但不进判决。

这条不会被「解决」。它的存在本身就是设计声明：这个工具判的是**合法与一致**，
不是**优秀**。

## L4 负例得人来补

`status: mitigated`

`negatives` 按清单的**声明**派生候选，不读观测：必填参数缺失、角色越权、类型不符、
主键指向不存在实体、重复提交。每条候选带 `basis`（哪条声明支持它）、`confidence`
和 `review`（人要想清楚的问题），全部 `status: disputed`，只写
`.agent-web/negatives/` 下的审阅表，**从不写进案例目录，也从不进判决**。

分得清的是「声明能推出来的」和「只有业务能定的」：重复提交幂等与否声明里没有，
所以它只给 `applied` / `rejected` 两个假设，不自带期望。

仍不解决的是：非法状态迁移需要状态机声明（当前清单没有这一项），
以及候选转正之后仍然要人署名 `accept`。

每条负例还要配一条 `window` 断言「被拒之后不许留下半条记录」，否则负例只证明了「被拒」，
没证明「没副作用」。验收：`node bin/agent-web.mjs negatives cases/coffee --adapter=memory`。

## L5 变异体仍有盲区

`status: mitigated`

`breed` 只从**观测形状**造故障（数值差一/翻倍/丢分、字符串置空/大写、数组丢尾/逆序、
枚举换值、嵌套叶子）。执行层（角色被忽略、重复写、丢中间步骤、陈旧读）与业务层
（超卖、退款超过实付、审批跳过）的坏法仍靠投稿——`docs/mutants/` 收的就是这类。

当前口径：22 个变异体，9 条案例，适用 19，抓到 17（89.5%），欠账 2，不适用 3。
这个数字是 `node scripts/certify-baseline.mjs` 每次跑出来的，不是写死的。

## L6 等价变异体问题没有解决

`status: by-design`

四十年没解决。这里只做三件事：显式化（杀不掉但造得出差异 → 欠账；连差异都造不出 → 说不清）、
要求投稿人给可区分性证明、把「说不清」从分母里分出来而不是混算。

**「说不清」不等于「等价」。** 只会记「预算内未找到见证」，永远不会写 `equivalent`——
那需要一个能机检的证明（脚本或有限状态穷举），口头声明只能标 `claimed`。

## L7 断言表达能力仍有缺口

`status: mitigated`

现有能力已覆盖：

- **时间窗** `window`：对步骤区间单独求 `unchanged` / `count_delta` / `field_equals` / `entity_exists`。
- **每步求值** `every_step`：检查中途状态，抓「中途坏、结尾修好」。
- **分页** `pagination`：检查跨页重复、边界丢行、翻页乱序和 `total`。
- **跨实体关联** `linkage`：检查集合之间引用存在性、字段约束与关联数量。

仍缺基于真实时间的约束，例如「发货必须在付款后 24 小时内」。这需要明确事件时间戳、时钟来源、时区、缺失时间与边界比较语义，不能只用轨迹步号代替。

新增 kind 的门槛照旧：**必须能杀掉至少一个现有断言杀不掉的变异体**
（`node scripts/kind-necessity.mjs` 逐种验），否则就是装饰，按判据准入宪法不许入库。

验收：`node scripts/kind-necessity.mjs` 退出码 0。

## L8 适配器可以撒谎

`status: open`

`probe` 查六项机械性质（manifest、五方法契约、复位、复位幂等、观测稳定、不泄漏状态）。
加载适配器等于以你的身份执行代码——`load.mjs` 直接 `import`，CLI 会提示一次，但那不是沙箱。

分得出的是「诚实但受限」与「机械上可查的谎」，分不出「会看探测器的骗子」。
收窄的方向是走 HTTP 的适配器用独立 `fetch` 交叉复核，以及进程级隔离（子进程 +
Node 权限模型，默认禁 fs/网络/子进程），并且文档必须写清：进程隔离不是安全边界。

## L9 并发被撤回了

`status: withdrawn`

试过。真实后端 12 变异体 × 8 案例：串行 77 秒，6 并发 8 秒。**但结论漂移了**——
同一个变异体从「被第 4 条断言抓住」变成「判决级 ×3」，还有变异体从欠账变成漏网；
串行连跑两次则逐字相同。

并发把「同一台机器上的时序」放进了被测系统，而跨实现对照的全部价值就在于两边跑的是同一件事。
快 9 倍但答案会变的评估器，比慢的那个更没用。代码已撤，**不提供 `--jobs`**，
原始记录见 `knowledge/k04-parallel-verdict-drift.mjs` 与 `docs/SPEC.md` 12.9.2。

恢复前的验收门槛已经做成了脚本，不再只是一句散文：

```bash
npm run determinism          # 同进程连跑两遍，比第 1 遍与第 N 遍
npm run determinism:baseline # 存一份指纹基线
npm run determinism:check    # 与基线比 —— 这才是串行 vs 并行的门
```

指纹取的是**判决相关的投影**：`status`、`reason_code`、`stage`、每条断言的
（序号, kind, 三值, 代码）、每一步的（capability, 身份, 期望结局, 实际结局, 错误码）。
默认不把 `createTime` 这类时间戳算进去，否则真实后端上这扇门永远是红的、人就会去关它；
要更严用 `--strict`，它额外比 `detail` 与去掉易变字段后的 evidence 摘要。

这个形状借的是 DeepInfer 的批次不变性测试（`tests/models/test_batch_invariant.py`）：
他们不比「两次输出文本一样」，而比 token_ids + logprobs + top-k 逐位相同 ——
**结论一致不等于过程一致**。这里同理：都 pass 了不算一致，死在哪条断言、每一步怎么走都得一样。

仍然撤回的部分：没有并行执行器，也没有适配器的 `concurrency.safe` 声明。
执行层要恢复并发，前提是每个任务有独立状态命名空间、夹具和资源配额。

## L10 难度标签只是统计

`status: mitigated`

已落地的统计链路：
- **跨批次可比**：`drill grade --record` 追加 `.agent-web/drills.jsonl`，只存题号、状态、每格的判定、提交指纹——不存提交内容；
- **区间**：`drill stats` 给 Wilson 95% 区间，`n < 5` 一律 `insufficient_data`，不给一个看起来像结论的百分比；
- **经验排序**：`drill --order=empirical` 按解出率排序，样本不足的排后面；
- **题面**：从 `KINDS` 插值（当前 17 种），`test/drill.test.mjs` 有守卫。

仍不解决的是：样本量依赖真实、独立的批改记录。没有外部提交者，台账里的难度只代表自测难度，不可推广为一般用户难度。

验收：`node bin/agent-web.mjs drill stats --min-attempts=5`。

## L11 只在四个域上验过

`status: ongoing`

咖啡点单（内存 + 真实 Spring Boot）、动物救助（真实后端 + 内存夹具）、复式记账（整数分 vs 两位小数）、
词库检索（字典树 + 贪心分词 vs 二分 + 反向 DP，900 条合成数据）。

前三个域逼出的机制是 `applies_to`：账本域的变异体在咖啡域记「不适用」，不进分母。
第四个域逼出的是**数据规模**：前三个域的分页断言只在小结果集上跑过，
「`total` 说谎」「边界丢行」这类坏法在小数据上每一页都是满的，看着全绿。
词库域还暴露了 `pagination` 的一个真盲区——它只数各页行数，从不读实现自己报的 `total`
（补了 `pagination_total_reported`，见 `src/assert/pagination.mjs`）。

**仍然只有四个。** 缺的是「长事务」「多租户」「异步回调」这三种形状，
它们不是再加一个 CRUD 域就能覆盖的，需要新的断言 kind（L7 的时间语义是其中一条）。

每加一个域的验收标准是：两个实现（或一个真实 + 一个孪生）、四类案例、三个域变异体、
`compare` 判决一致率 100%、`probe` 通过、`certify` 基线不倒退。做不到就说明词汇还缺，
缺口写进 `docs/domains/<name>.md`。

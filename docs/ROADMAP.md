# 路线图：从 v0.54.2 到 v0.60

这份文档回答一个问题：**接下来该做什么，按什么顺序，做到什么程度算完成。**

每条都带验收命令。验收不是「跑通了」，是「这条能不能被证伪」——所以每条都写清了
「怎么证明它没做到」。

---

## 0. 现在的实际状态（v0.54.2，全部实测）

| 项 | 数字 | 怎么核 |
|---|---|---|
| 版本 | 0.54.2 | `node bin/agent-web.mjs version` |
| 断言 | 19 种 | `--help` 里的断言表 |
| 命令 | 31 条 | 同上 |
| 变异体 | 56 个 | `node bin/agent-web.mjs mutants` |
| 测试 | 401 条 | `npm test` |
| 判据准入 | 适用 41 / 抓到 39（95.1%） | `node scripts/certify-baseline.mjs --emit-limits` |
| 计入的域 | **4 个** | `docs/LIMITS.md` L11 的五条门槛 |
| 台账状态 | L1/L2/L4/L5/L7/**L8**/L10 mitigated · L3/L6 by-design · L9 withdrawn · L11 ongoing | `grep status docs/LIMITS.md` |

**v0.54.0 起台账上不再有 `open` 的条目。**这不是说其余十条解决了，是说它们都降到了
「有明确边界、有验收命令、边界写在文档里」的状态。

---

## 1. 排序原则

只按三条排序，不按「想做什么」排：

1. **唯一 `open` 的先做。** （v0.54.0 起这条已执行完毕：L8 降到 `mitigated`，台账上不再有 `open`。）
   这条原则保留在这里，是因为它还会再用一次——任何新增限制一旦挂上 `open`，它就重新生效。
   留一条 `open` 在台账上，等于承认有个洞既不修也不声明边界。
2. **能把「声明」变成「实测」的先做。** L11 写着「只在四个域上验过」——这是诚实的，
   但 RealWorld 已经有 13 条案例、只差 10 条红没清。清掉之后域数从 4 变 5，
   这条就从「限制」变成「已验五域」。**声明升级比新增功能更值钱。**
3. **最便宜的诚实先做。** L3（不判质量）是 `by-design`，但「能数的东西没数」是另一种不诚实。
   步数、重复读、绕路次数这些是**计数不是评分**，不进判决却可以进 `report`。

不做的理由也写在这：任何需要引入打分模型、LLM judge、或者「更聪明」的猜测的工作，
一律不进这份路线图。那是把要解决的问题搬回来。

---

## 2. P6 — 交叉复核（L8）✅ 已完成（v0.54.0）

**结果**：L8 `open` → **`mitigated`**。`agent-web crosscheck --adapter=SPEC` 已上线，
三类结论 `consistent` / `divergent` / `uncheckable`，`uncheckable` 单列且不算通过。

反向验证两条都跑过：`test/fixtures/lying-http-adapter.mjs` 报 `divergent`（同一适配器里
原样转发的 `tags.list` 仍是 `consistent`，证明不是见谁咬谁）；诚实适配器全 `consistent`
（证明不是恒红）。内存适配器 → `uncheckable`，exit 2。

**下面保留原计划正文**，作为这条的验收记录。

### 2.1 做什么

走 HTTP 的适配器，用一个**不经过适配器自己那个 `fetch`** 的通道再发一遍同样的请求，
比对两边拿到的响应。适配器能骗过探针（它知道自己被探测），骗不过「同一时刻两个通道
看到的东西不一样」。

新增命令：

```bash
agent-web crosscheck --adapter=SPEC --out=报告目录     # 待实现（P6 的交付物）
```

> 下面验收小节里的 `crosscheck` 在 P6 完成前不存在。这条路线图的写法是**先写验收再写实现**，
> 所以 `test/roadmap.test.mjs` 只检查已经在 `bin/agent-web.mjs` 里注册过的命令。

### 2.2 三类结论，缺一不可

| 结论 | 含义 | 处理 |
|---|---|---|
| `consistent` | 两个通道拿到同一个响应 | 这一条能力可信度升级 |
| `divergent` | 两边不一样 | **适配器在撒谎，或者中间有缓存**，报红 |
| `uncheckable` | 适配器不走 HTTP（内存/孪生/夹具） | 明确说「这条路查不了」，不记成一致 |

`uncheckable` 必须单列且**不能算通过**。把「查不了」记成「没问题」是这类工具最容易犯的错。

### 2.3 验收（能证伪的那种）

```bash
# 必须一致：真实后端
agent-web crosscheck --adapter=taixianglian   # 期望 exit 0，全部 consistent

# 必须 divergent：故意骗人的夹具
agent-web crosscheck --adapter=test/fixtures/lying-http-adapter.mjs
# 期望 exit 1，且报告里点名是哪一条能力、两个通道各拿到什么

# 必须 uncheckable：内存适配器
agent-web crosscheck --adapter=memory
# 期望 exit 1，全部 uncheckable，理由写「不走 HTTP」
```

**怎么证明它没做到**：把 `lying-http-adapter` 的谎去掉，如果仍然 exit 1，说明检测器
在乱报；把真实后端的返回改一个字节，如果仍然 consistent，说明它根本没比对。

### 2.4 边界（写进 LIMITS，不改口）

进程隔离**不是安全边界**。适配器可以起子进程、读文件、发网络，Node 权限模型也拦不住
一个铁了心的适配器。这条只做一件事：**让「走 HTTP 的适配器」有一个可机检的交叉证据**。
不走 HTTP 的，永远只能靠人看代码。

预计：2 天。

---

## 3. P7 — 给 RealWorld 补第二个实现（L11）

**目标**：域数 4 → 5，L11 从 `ongoing` 变成「已验五域」。

### 3.0 前提：十条红**已经清完了**（v0.46.0，commit `d001436`）

`agent-web verify cases/realworld --adapter=realworld` = **13/13 pass**（实测，2026-11-06 复核）。
`examples/realworld/FIX-PLAN.md` 顶部已标记「已完成」。这一节原来写的是「清十条红」，
现在改成「补第二个实现」——因为红没了，域数没涨，卡的是另一个门槛。

### 3.1 现状

施工单已在 `examples/realworld/FIX-PLAN.md`（138 行），分四类十条：

（这四类已全部修完，保留在此作为记录：A 转换器/适配器、B 夹具缺业务语义、C 夹具错误文案、D 夹具缺唯一性/鉴权。）

### 3.1.1 真正卡住的是「只有一份实现」

`cases/` 有五个目录，但 `realworld` 只有一个实现（`examples/realworld/fake-server.mjs`）。
域的门槛要求两个独立实现 + `compare` 一致率 100%——只有一份，「跨实现一致性」就验不了。

补法：拿同一份 `openapi.yml` 写第二个实现（换个写法：`decl` 的 YAML 声明式适配器打同一个夹具，
或者真打 Postgres）。然后：

```bash
agent-web compare cases/realworld --adapters=realworld,realworld-b   # 期望 100% 一致
```

### 3.2 铁律（施工单里已写，这里再强调）

1. 先判错在哪一层（转换器 / 适配器 / 夹具 / 契约没规定），别一上来就改案例。
2. **不许改案例与 `expected.json`，不许删断言。** 改了就等于把尺子削短。
3. 每修一条，必须能人为塞回故障再转红（反向验证）。
4. 一条一提交，提交信息写明层与反向验证。
5. 每步跑全量记 pass 数，`3 → 13`。**中途变少必须停**。

### 3.3 验收

```bash
agent-web verify cases/realworld --adapter=realworld   # 13/13 与 expected.json 一致
npm test                                               # 377 → 增加 realworld 域测试
```

**怎么证明它没做到**：把任意一条修好的能力塞回原来的故障，必须转红。转不红说明
修的是案例不是夹具。

预计：3 天（十条，每条半天以内）。

---

## 4. P8 — 计数不等于评分（L3）

**目标**：L3 保持 `by-design`，但把「能数的东西」真的数出来。

### 4.1 为什么这条不算「解决 L3」

L3 说的是「不判质量」。给它加个 0-100 分就是把它变成 `open`——引入打分模型，
等于把要解决的问题搬回来。所以这条**不加判决**，只加计数。

新增：

```bash
agent-web report <results.jsonl> --counts
```

输出（全部是计数，没有任何一个字段叫 score / grade / quality）：

| 计数 | 定义 |
|---|---|
| `steps` | 轨迹步数 |
| `repeat_reads` | 同一个读能力对同一参数读了多次 |
| `detour_ratio` | 实际步数 / 最小可达步数（用案例的依赖图算） |
| `wasted_writes` | 执行了但被后续步骤撤销的写（需要能识别撤销配对） |
| `retries` | 同一能力连续失败后重试的次数 |

### 4.2 硬约束

- **不进判决**。`report` 的输出不参与 pass/fail/unknown。
- **不排序、不给建议**。「绕路比 2.4」是事实，「建议优化」是评分。
- `detour_ratio` 的最小步数必须是**从案例依赖图算出来的**，不是人填的。

### 4.3 验收

```bash
agent-web report .tmp-r.jsonl --counts   # 输出五个计数，没有第六个字段
```

**怎么证明它没做到**：输出里出现 `score`、`grade`、`rank`、`建议`、`优秀`、`较差`
任何一个词，就是越界了。`test/report-counts.test.mjs` 会扫输出文本查这些词。

预计：1 天。

---

## 5. P9 — 第五、第六个域（L11 的长期工作）

P7 清完 RealWorld 是第五个域。第六个应该选**形状与前五个都不同**的：

| 域 | 逼出什么机制 |
|---|---|
| 咖啡 / 动物 / 账本 / 词库 / RealWorld | （已有） |
| **定时任务型**（cron 驱动的对账、清理） | 时间推进：`timeliness` 只能比两个事件，比不了「隔天该跑一次」 |
| **多人协作型**（评论、@提醒、权限继承） | 角色不是单射而是层级：`staff ⊃ customer`，现在的 `roles` 是平铺集合 |

优先级：定时任务型 > 多人协作型。理由：时间推进是**现有断言完全表达不了**的维度，
而角色层级至少能用 `composite` 拼出来。

### 5.1 验收

新域要能**独立通过** L11 的五条门槛（`docs/LIMITS.md` 末节），一条不缺：

```bash
agent-web verify cases/<新域> --adapter=<新域>
agent-web probe --adapter=<新域>
agent-web certify cases/<新域> --adapter=<新域>
```

**怎么证明它没做到**：新域的变异体如果全部「不适用」，说明它只是把旧域换了个名字——
形状与前五个域没有本质差别，不算新域。

---

## 6. 明确不做（写在这里，防止以后再讨论）

| 不做 | 为什么 |
|---|---|
| LLM judge | 判据准入宪法第一条。机器判不了的就不判，留 `unknown` |
| 浏览器 Agent 模型 | 这个项目是**测量仪器**，不是被测对象 |
| 视觉 grounding | 同上。适配器层已经足够抽象 |
| 全自动适配器生成 | `discover` 只做只读，写操作的语义必须人给 |
| 并发执行 | L9 已撤回：快 9 倍但答案会变，跨实现对照的价值全在「两边跑的是同一件事」 |
| 打分 / 排名 | L3 的设计声明 |
| 进程级沙箱 | L8 的边界：拦不住铁了心的适配器，写了反而给人虚假安全感 |

---

## 7. 顺序与预计

| 顺序 | 项 | 预计 | 完成后台账变化 |
|---|---|---|---|
| 1 | ~~P6 交叉复核~~ **已完成 v0.54.0** | 2 天 | L8 `open` → **`mitigated`** |
| 2 | P7 给 RealWorld 补**第二个实现**（不是第二个适配器） | 3 天 | L11 `ongoing` → 五域 |
| 3 | P8 计数 | 1 天 | L3 仍 `by-design`，但「能数的都数了」 |
| 4 | P9 定时任务域 | 3 天 | L7 的「跨实体时序」有真靶子 |

**P6 已完成**（v0.54.0）。它先做的理由成立：它是唯一 `open` 的。一条 `open` 挂在台账上超过两个版本，
就会变成「大家都知道有问题但没人管」——那时候台账就不再是台账，是装饰。

**P7 第二**：十条红在 v0.46.0 就清完了（commit `d001436`），所以 P7 剩下的不是修 bug，
是补第二个**实现**。放第二是因为它没有设计不确定性，只有工程量。

---

## 8. 这份路线图本身怎么维护

- 每条完成时，**同时**更新 `docs/LIMITS.md` 与这里。两处不一致会被
  `test/limits.test.mjs` 抓（它比对台账条目与 README 的十一条）。
- 加新条目必须带**验收命令**与**怎么证明它没做到**。没有这两样的条目不许进这份文档。
- 每发一版，第 0 节的数字由脚本重算（`node scripts/certify-baseline.mjs --emit-limits`
  + `node scripts/status-line.mjs`），不手写。


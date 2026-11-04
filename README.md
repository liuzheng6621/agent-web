# agent-web

**让智能助手做完事情后，用清楚的规则检查结果。**

[中文](README.md) · [English](README.en.md)

智能助手能帮人下单、处理工单、更新库存。难的是：怎么确认它真的做对了？

agent-web 像一位按清单检查的质检员：先说明「什么结果才算做对」，再让助手做事，最后检查实际结果。它不凭语气、印象或另一个模型的评分下结论。

**一句话：同一张考卷，可以考不同的系统；判分规则不变，结果就能公平比较。**

---

## 它会给出三种结果

| 结果 | 日常说法 | 例子 |
| --- | --- | --- |
| `pass` | 通过 | 订单已下好，也由正确的人取走 |
| `fail` | 没通过 | 订单还没准备好，助手却说已经完成 |
| `unknown` | 现在无法判断 | 系统没有提供相关信息，或测试连接出了问题 |

「不知道」不等于「做错了」，也不等于「做对了」。所以 `unknown` 单独记录，不会被算成通过：

```text
可判断比例 = (通过 + 没通过) / 全部案例数
无法判断比例 = 无法判断 / 全部案例数
```

这样不会因为测不出来，就把成绩涂成绿色。

---

## 用一杯咖啡看懂它

题目：顾客下单，店员接单并做好，**下单的顾客本人**取走咖啡。

检查清单可以写成：

1. 订单数量增加一笔。
2. 订单最后状态是「已取走」。
3. 订单经过「制作中 → 可取 → 已取走」这些状态。
4. 其他顾客不能取走这笔订单。

助手可能用不同步骤完成任务，只要最终结果符合规则就可以通过。反过来，步骤看起来很像、结果却不对，就不能通过。

---

## 3 分钟试跑

需要 Node.js 20 或更新版本，不需要安装额外依赖。

```bash
git clone https://gitee.com/liu-everything_impossble/agent-web.git
cd agent-web

# 跑内置样例，不连接外部服务
node bin/agent-web.mjs selftest

# 检查一条具体案例
node bin/agent-web.mjs verify cases/memory-demo/happy-path.json --adapter=memory
```

`selftest` 会跑 7 条样例：正常完成、越权、漏步骤和无法判断等情况。样例通过表示程序的基本判分流程正常，不代表所有真实系统都已测过。

---

## 推荐流程：一份日志，三个可检查的产物

助手已经跑过一次，并且你拿到了它发出的请求日志？用 `prepare` 一次生成可重放步骤、待确认案例草稿和流程预览：

```bash
node bin/agent-web.mjs prepare examples/agent-traces/memory-happy-path.jsonl \
  --adapter=memory \
  --id=coffee/happy-path \
  --goal="顾客下单后由本人取走" \
  --out-dir=agent-web-output/coffee-happy-path
```

结束后会得到：

```text
agent-web-output/coffee-happy-path/
├── trajectory.json     从日志还原的操作步骤
├── case.draft.json     根据实际结果生成的待确认检查清单
└── case.flow.html      可双击打开的流程预览
```

按这个顺序接手：

1. 打开 `case.flow.html`，先看每一步有没有认错人、认错操作。
2. 检查 `case.draft.json` 里的目标、检查项和「待确认」提示；草稿描述的是这次发生了什么，**自检通过不等于规则正确**。
3. 补上真正的业务目标和负例（例如别人不能取走订单），确认后再用 `verify` 检查。

`prepare` 会在你指定的测试适配器上重放日志里的写操作，所以只连隔离的测试环境，**不要指向生产系统**。疑似密码、令牌、Cookie 等敏感字段会让流程停止，不会写入产物。若输出文件已存在，也会停止，不覆盖旧文件。

演示日志用简化格式：写清操作名、角色、结果和参数，不需要网络地址。真实 HTTP 日志也能处理，但适配器必须先声明接口地址如何对应操作、请求参数如何转换。要接入自己的服务，把 `--adapter=memory` 换成自己的连接程序，并使用专用测试环境。

检查草稿后，补好目标并添加必要的负例。人工确认完成时，删掉案例 JSON 最后的 `draft` 注记，再运行：

```bash
node bin/agent-web.mjs verify agent-web-output/coffee-happy-path/case.draft.json --adapter=memory
```

这一步能证明案例可执行、格式正确；业务检查项是否完整，仍以人工确认结果为准。

---

## 把助手做过的步骤拿来检查

案例自带的步骤是参考答案，不一定是助手实际走过的路。要检查助手自己的操作记录，先运行：

```bash
node bin/agent-web.mjs verify cases/memory-demo \
  --adapter=memory \
  --trajectory=examples/candidate-trajectories \
  --out=candidate-results.jsonl
```

这里的 `--trajectory` 指向助手实际步骤的文件夹；`--out` 把每条案例的判分结果保存起来。仓库带有两条演示步骤：一条只下单就停下，另一条补做一步后达成目标。

**检查的是结果，不是动作是否照抄参考答案。** 参考步骤没完成目标，而助手换了一条路完成了，助手仍然可以通过。

---

## 看流程图

把判分结果变成可以打开的 HTML 页面：

```bash
node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --result=candidate-results.jsonl \
  --out=happy-path.flow.html
```

如果要画候选步骤，结果文件必须由同一条候选步骤跑出来：

```bash
node bin/agent-web.mjs verify cases/memory-demo/happy-path.json \
  --adapter=memory \
  --trajectory=examples/candidate-trajectories \
  --out=happy-path-candidate.jsonl

node bin/agent-web.mjs flow cases/memory-demo/happy-path.json \
  --trajectory=examples/candidate-trajectories \
  --result=happy-path-candidate.jsonl \
  --out=happy-path-candidate.flow.html
```

生成的 HTML 是独立文件，双击就能打开，不需要网页服务器。它展示每一步是谁做的、原本预期是什么、实际发生了什么、状态如何变化、检查项是否通过。可以筛出出错或没执行的步骤，点开步骤看参数；也可以切换浅色和深色主题。

页面适配电脑、平板和手机；支持键盘操作。敏感参数（例如 token、password、cookie）会自动遮盖。流程图只展示已有数据，不会再次执行助手的操作。

---

## 把真实请求日志变成步骤

如果系统能导出助手发出的请求，可以用 `record` 把日志整理成上面的步骤文件：

```bash
node bin/agent-web.mjs record examples/agent-traces/happy-path.jsonl \
  --adapter=taixianglian \
  --out=examples/agent-traces/recorded/happy-path.json
```

日志可以是 JSONL（每行一条 JSON）或 JSON 数组。每条请求至少要记录操作者、请求方法和地址；最好也保留请求内容与响应结果。登录密码和令牌不要放进日志。

`record` 会把后续步骤用到的订单编号，改成「引用前一步创建的订单」。这样换一套测试数据后，步骤仍能接着跑。看不懂、无法确认结果的请求会列出来跳过，不会猜。

如果想自己分开检查每一步，使用下面两个独立命令：

```bash
# 1. 请求日志 → 可重放步骤
node bin/agent-web.mjs record examples/agent-traces/memory-happy-path.jsonl \
  --adapter=memory --out=/tmp/coffee-trajectory.json

# 2. 可重放步骤 → 待确认案例草稿
node bin/agent-web.mjs draft /tmp/coffee-trajectory.json \
  --adapter=memory --out=/tmp/coffee-case.draft.json

# 3. 草稿 → 流程预览
node bin/agent-web.mjs flow /tmp/coffee-case.draft.json \
  --out=/tmp/coffee-case.flow.html
```

平常直接用 `prepare` 即可；`record`、`draft`、`flow` 留给想单独检查或替换其中一步的情况。

---

## 从做过的步骤生成案例草稿

```bash
node bin/agent-web.mjs draft examples/agent-traces/recorded/happy-path.json \
  --adapter=memory \
  --out=examples/agent-traces/drafts/happy-path.case.json
```

它会重新跑一遍这些步骤，根据前后状态写出检查清单，例如「订单多了一笔」「订单最后是已取走」。**草稿照抄的是这次实际发生的事，所以它自己检查时通常会通过；这不表示清单写对了。**

人工确认时重点看：

- 这些结果是不是业务真正要求的？
- 有没有「不该发生」的情况需要补测，例如别人不能取单？
- 清单是否把测试编号、账号等每次都会变化的内容写死了？

猜不出来的内容会列在草稿的「待确认」中，不会自动变成检查规则。

---

## 用同一题比较两套系统

agent-web 自带一个内存里的演示系统，也能连接咖啡店示例后端。两边用同一批案例：

```bash
# 咖啡店示例服务须先在本机 8080 端口运行
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8080 \
  node bin/agent-web.mjs compare cases/memory-demo \
  --adapters=memory,taixianglian
```

示例结果：

```text
案例                           内存样例      咖啡店服务    结果相同
memory/happy-path             pass          pass          ✓
memory/foreign-pickup         fail          fail          ✓
memory/unknown-capability     unknown       unknown       ✓

同一案例判分一致率 100.0% (7/7)
```

两边答案不同，不表示哪边一定有问题；它提醒你检查：案例规则是否说清楚、连接方式是否把顾客 A 和顾客 B 当成了不同的人、或两个系统的实际行为是否不同。

这套对照曾抓到一个真实问题：案例说「顾客 B 去取」，判分结果却说通过。检查后发现，不是咖啡店放错了咖啡，而是连接程序把顾客 A 和 B 都当成顾客 A，实际执行的是「A 取自己的订单」。它测错了人，判分却看起来完全正常。换另一套独立实现后结果对不上，才暴露了这个问题。完整经过见 [事故记录](docs/FINDING-001.md)。

---

## 发现系统版本变化

同一条案例，系统升级前后可能遇到不同的初始数据。先分别保存两次测试结果，再比较：

```bash
node bin/agent-web.mjs verify cases/memory-demo --adapter=memory --out=before.jsonl
# 应用更新后再跑一次，保存为 after.jsonl
node bin/agent-web.mjs verify cases/memory-demo --adapter=memory --out=after.jsonl
node bin/agent-web.mjs drift before.jsonl after.jsonl
```

`drift` 检查测试开始时看到的数据是否变化。发现变化时，表示需要复查案例是否还适合新版系统；它不是在说这次测试判错了。

---

## 接入自己的系统

用 `--adapter` 指向一个小型连接程序：

```bash
node bin/agent-web.mjs verify my-cases --adapter=./my-adapter.mjs
```

仓库里的 `examples/adapter-template/` 有可运行样例。这个连接程序负责五件事：

| 方法 | 做什么 |
| --- | --- |
| `manifest()` | 告诉工具能做哪些操作、能查看哪些数据 |
| `reset()` | 准备一份干净的测试数据 |
| `observe()` | 读出当前订单、库存等状态 |
| `execute()` | 让系统执行一步操作 |
| `close()` | 结束并清理本次测试资源 |

具体代码和案例格式见 [接入样例](examples/adapter-template/README.md) 与 [详细格式说明](docs/SPEC.md)。

---

## 术语对照

代码中保留固定英文名字，文档用日常说法解释：

| 代码里的词 | 简单解释 |
| --- | --- |
| Case（案例） | 一道题：目标、检查规则和参考步骤 |
| Trajectory（步骤记录） | 助手实际做过的一连串操作 |
| Adapter（连接程序） | 把测试工具接到真实系统上的小程序 |
| Assertion（检查项） | 能用明确事实回答「对 / 不对」的规则 |
| `unknown` | 目前没有足够信息判分 |
| Reset（重置） | 为下一次测试准备全新的数据，避免上次结果干扰 |

---

## 能检查什么

| 检查项 | 日常说法 |
| --- | --- |
| `entity_exists` | 有没有出现指定记录 |
| `field_equals` | 某个字段是不是指定内容 |
| `count_delta` | 记录数量前后增加或减少多少 |
| `unchanged` | 某些数据前后有没有改变 |
| `status_transition` | 状态有没有经过指定的变化 |
| `event_absent` | 整个过程中有没有发生禁止的事件 |
| `composite` | 把多个检查项用「并且 / 或者 / 不是」组合起来 |

它能检查订单状态、记录数量和事件记录等明确事实；不判断页面好不好看、回答有没有文采、或主观上「感觉是否合适」。这些没有清楚标准的部分，不会被伪装成机器判分。

---

## 当前限制

- 每种真实系统都要有人编写连接程序；目前不能只给一个网址就自动接入。
- 不同系统里的数据名称需要通过连接程序统一；目前不会自动把 `orders` 和 `tickets` 对应起来。
- 现在主要检查操作结束后的结果和已记录的事件；例如「点了三次才点对」这种过程质量还无法完整衡量。
- 测试按顺序执行，目前没有多机并行运行。
- 草稿只能根据已发生的事情列清单；禁止行为、权限边界和时间要求仍需要人工补充。

---

## 项目文件

```text
bin/agent-web.mjs       命令行入口
src/                   判分、案例、记录、草稿和流程图代码
cases/                 内置测试题
examples/              可运行的连接样例与日志
  agent-traces/memory-happy-path.jsonl   可直接试用 prepare 的简化日志
docs/SPEC.md            案例文件的详细格式
test/engine.test.mjs    自动测试（49 条）
```

常用命令：`prepare`（一条命令生成步骤、案例草稿和流程预览）、`selftest`（跑内置检查）、`verify`（检查案例）、`compare`（比较不同系统）、`record`（整理请求记录）、`draft`（单独生成案例草稿）、`flow`（生成流程图）、`drift`（比较两次初始数据是否变化）。运行 `node bin/agent-web.mjs help` 查看完整命令。

---

## 版本与后续

当前版本 `0.6`：可以跑案例、检查助手实际操作，并用一条 `prepare` 命令从请求日志生成可重放步骤、待确认案例草稿和流程预览。

后续方向：让不同数据结构的系统更容易共用案例、让多套系统并行测试，以及让「根据现象推测出来的能力」能通过验证升级为「实际验证过的能力」。

MIT 许可，见 [LICENSE](LICENSE)。

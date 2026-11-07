# 给 Agent 的说明书

这个文件是给**要改这个仓库的 AI Agent** 读的。人类读者请先看 [CONTRIBUTING.md](CONTRIBUTING.md)，那份更完整；这一份只写 Agent 最容易搞错的地方。

## 先搞清楚这个仓库在干什么

它不是"一套断言库"。它是一组主张：

> 一个 Agent 集成测试的判决，只有在**环境可复位**、**断言机器可判**、**判决能复现**这三件事同时成立时才算数。而"不知道"必须作为一种**独立结论**存在，不能被折叠成"失败"或"跳过"。

所以你的改动要按这个标准衡量，不是按"功能是否更多"衡量。

## 五条硬约束（违反即不可合并）

**1. 三值判决，`unknown` 留在分母里。**
`src/runner.mjs` 里有一张判决顺序表，顺序本身是规范的一部分（`docs/SPEC.md` 第 7 章）。不要重排它，不要给任何一条加"自动降级"。

**2. 禁止 LLM judge。**
任何断言、探针、判决都不能问模型"这样对不对"。判不了就写进 `docs/LIMITS.md`。

**3. 分类语义只能有一份实现。**
`src/step-outcome.mjs` 的 `classifyStepOutcome()` 是唯一入口，`src/runner.mjs`（执行）与 `src/draft.mjs`（回放）都调它。历史上这两处各抄了一份 if 链，第二份带着同一个"契约外 outcome 假通过"的洞活了一个版本（展品 08）。`test/step-outcome.test.mjs` 会扫源码：这两个文件里手写 `res.outcome === '<字面量>'` 只允许出现 `applied` 一处。

**4. 新增一个理由码 = 改两个地方。**
代码里产出 + `src/reasons.mjs` 登记。`test/reasons.test.mjs` 双向查：产出了没登记要红，登记了没产出也要红。四个命名空间（verdict / assertion / probe / error）**不能混**——同一个词在不同层含义不同（`ok` 既是判决通过码又是断言成立码）。

**5. 新增断言必须能杀掉至少一个变异体。**
`node scripts/kind-necessity.mjs` 会把你新加的断言摘掉再跑，如果没有任何变异体从 `caught` 掉下来，这条断言不增加判别力。

## 这个仓库特有的坑（都踩过，别重踩）

### 契约外的 `outcome` 会假通过

适配器的 `execute()` 必须返回 `applied` / `rejected` / `unsupported` / `infra_error` / `may_have_committed` 之一。返回别的（`'success'`、`'ok'`、`'APPLIED'`、带尾空格的 `'applied '`）时，旧代码的四个分类分支都不命中，这一步既不失败也不 unknown，一路滑到终态断言假 `pass`。

`classifyStepOutcome()` 现在会拦住，判 `unknown` / `contract_violation`。**加新分支时，兜底分支是必须的**——返回值风格没有异常机制兜底，漏写 `else` 不报错。

### `may_have_committed` 与 `infra_error` 是相反的指令

- `infra_error`：**允许重放**（这一步肯定没生效）。
- `may_have_committed`：**不许重放**（可能已经生效，重放会造成重复副作用）。

两者都判 `unknown`，但后续动作相反。别合并成一个码。

### `applies_to` 不要省略

变异体的 `meta.applies_to` 省略等于"所有域都适用"，会把每个新域的分母撑大。跨域通病写 `{}`，为的是跟"忘了写"区分开。`test/certify-applicability.test.mjs` 断言没有任何变异体省略它。

### 环境没起来的时候，不许报数字

`certify` 在案例的正确实现全部跑不起来时，必须印"这一跑不成立"并**退 2**，不许印 `0.0%`。`0.0%` 会被读成"断言一条都抓不住"（该去补断言），实际含义是"一条案例都没跑起来"（该去起服务）——方向相反。

判据是 `UNUSABLE_CODES`（在 `src/traps.mjs`，导出给 `certify` 复用，不许抄第二份）。

### 适配器的 `execute()` 第一参是 `runId`，不是能力名

```js
execute(runId, { capability, arguments, as })
```
写成 `execute(capability, args)` 会让所有步骤报 `unsupported`，而错误信息看起来像是后端不支持——很难查。

### 忽略 `as` 会让越权案例假通过

越权案例的全部意义是"用 A 的身份做 B 的事，应该被拒"。适配器忽略 `action.as`、一律用管理员身份执行时，该被拒的做成了，`expected_outcome: 'rejected'` 的断言反而……照样能过（因为业务上真的拒了别的错）。实测踩过两次。

### 视图里不能放本轮专属值

`observe()` 返回的视图要能被两次独立运行比较。放了 `runId`、时间戳、自增 id 这类本轮专属值，`compare` 永远不等。

## 工作方式

### 改之前先跑一遍

```bash
npm test
node scripts/status-line.mjs
node bin/agent-web.mjs selftest
```

`status-line.mjs` 会校验五处版本号一致（`package.json` / `VERSION` / 两份 README 的 H1 与状态行 / `CHANGELOG.md` 首条）。**版本号唯一来源是 `package.json`**。

### 改完必须过的门

```bash
npm test                              # 513 条
node scripts/status-line.mjs
node scripts/certify-baseline.mjs     # 漏网必须正好是基线里那几个
node scripts/certify-can-fail.mjs     # 判据准入自己能被证伪
node scripts/kind-necessity.mjs       # 每种断言都得证明自己有用
node scripts/state-equivalence.mjs    # 快路径与重放逐格相同
node bin/agent-web.mjs selftest
```

跑之前**先杀掉 8486–8700 之间的 `gh-proxy` 隧道**，`test/crosscheck.test.mjs` 会撞 `EADDRINUSE`。

### 本机工具注意事项

- `write` / `edit` 工具在本机全盘报 `EISDIR`，一律走 `ops_bash` heredoc。
- heredoc **单次上限约 8KB**，超了会静默截断——大文件分段写或改用 python 写盘。
- heredoc 会吃掉反斜杠：`\n` 变真换行、`\(` 变 `(`。写正则必须用 `chr(92)` 拼。
- `bin/agent-web.mjs`、`CHANGELOG.md`、`docs/SPEC.md`、两份 README 是 **CRLF**。补丁脚本必须 `io.open(p,'rb').read()` → 改 → `io.open(p,'wb').write()`；文本模式写会把 `\r\n` 二次翻译成 `\r\r\n`。
- python 输出中文要 `PYTHONIOENCODING=utf-8`，否则 GBK 乱码会让你误判"服务端存坏了"。
- `/tmp` 在 node/python 里解析成 `E:\tmp`，一律用仓库内 `.tmp-*`，用完 `rm -rf`。
- `cmd | tail` 拿到的是 `tail` 的退出码。判成败用 `out=$(cmd); rc=$?`。
- `sed -i` 改 `package.json` 的 test 串会因串太长匹配失败，用 python 精确替换。

### 提交

```
type(scope): 一句话说清做了什么

为什么这么做。如果修掉的是一个"安静的错误"，写清它为什么会安静。
```

不要写"优化""完善""改进"。不要 `git commit --amend` 已推送的提交。**不要自己 push**，除非用户明确要求。

## 你在写文档时的额外责任

这个仓库的文档是**判据的一部分**，不是说明材料：

- `scripts/status-line.mjs` 读 README 的 H1 和状态行；
- `test/roadmap.test.mjs` 读 `docs/ROADMAP.md` 第 0 节的精确字符串（比如 `| 变异体 | 63 个 |`，改成 `63 个（全部声明了 applies_to）` 就会红）；
- `test/limits.test.mjs` 读 `docs/LIMITS.md` L5 行的数字并与实测比对；
- `test/readme-boundary.test.mjs` 比对两份 README 的"已实现"一节。

所以：**不要在文档里写你没有验证过的数字**。文档说"欠着"而实际已做完，比"做了没说"更糟——会让人重做一遍。

## 目录速查

```
bin/agent-web.mjs     32 条命令的入口（CRLF）
src/runner.mjs        判决主循环（判决顺序表在这里）
src/step-outcome.mjs  步骤分类的唯一实现
src/reasons.mjs       四张理由码登记表
src/certify.mjs       变异体抓获率（快路径 + 重放）
src/probe.mjs         十二项机械性质探针
src/traps.mjs         盲区/作废判决的判据（UNUSABLE_CODES）
src/adapter/          适配器契约与内置适配器
src/assert/           20 种断言
cases/<domain>/       案例（一条案例 = 一次真实业务操作）
docs/mutants/         63 个变异体
docs/museum/          11 件展品（每个真 bug 一件，带 naive/caught 对照）
docs/SPEC.md          规范（2070 行，判决顺序、断言语义、理由码）
docs/LIMITS.md        11 条限制的台账
test/                 50 个测试文件
scripts/              9 个自检脚本
```

## 最后一条

如果一次改动让某个判决从 `pass` 变成 `unknown`，**先别急着修**——问一下这次改动是不是让一个原本假通过的东西暴露了。这个仓库里 `unknown` 变多通常是好事。

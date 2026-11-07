# 参与这个仓库

先说清一件事：**这个仓库的宪法比功能重要**。它不是"一套测试工具"，而是一组关于"什么样的判决才算数"的主张。所以贡献方式分两类，门槛完全不同。

## 三条不可谈判的规则

改动如果违反其中任何一条，无论测试多绿都不会被合并。这三条不是风格偏好，是项目存在的理由。

**一、判决只有三种：`pass` / `fail` / `unknown`。**

`unknown` 不是失败，也不是"跳过"。它表示**这一次执行没有产生可信结论**，并且**它留在分母里**。任何把 `unknown` 折叠进 `fail` 或从分母里删掉的改动，都是把"不知道"伪装成"知道"。`src/runner.mjs` 的判决顺序表就是这条规则的实现，顺序不能改。

**二、断言必须机器可判。禁止 LLM judge。**

一条断言能不能成立，只能由代码算出来。不接受"让模型看一眼说对不对"——那样的判决无法复现，也无法在 CI 里跑，且它把"判定权威"从规范悄悄换成了一个概率分布。如果你觉得某件事"只能靠模型判断"，正确做法是**把它写进 `docs/LIMITS.md` 说清为什么现在还判不了**，而不是绕过这条规则。

**三、新增一种断言，必须能杀掉至少一个变异体。**

这叫**判据准入**。`scripts/kind-necessity.mjs` 会验：把你新加的断言从目录里摘掉，如果没有任何变异体从 `caught` 掉成 `killable`/`undetermined`，那这条断言没有增加任何判别力，它只是让报告好看。

这条规则的用途是防"断言通胀"——一个断言种类很多、实际什么都抓不住的工具，比断言少但每条都咬人的工具更危险，因为它给人虚假的安全感。

## 环境

零依赖。**没有 `npm install` 这一步**，克隆下来直接跑：

```bash
git clone https://github.com/liuzheng6621/agent-web.git
cd agent-web
node bin/agent-web.mjs selftest     # 第一条命令不需要任何准备
npm test                            # 513 条单元测试
```

要求 Node >= 20。不要引入运行时依赖——`package.json` 里没有 `dependencies` 字段是**故意的**，它保证了"跑不起来就是真跑不起来"，而不是"某人机器上少装了个包"。

## 提交之前必须过的门

`npm test` 全绿只是起点。下面五个脚本是这个工具在检查自己，CI 里逐个跑，本地也要跑：

```bash
node scripts/status-line.mjs        # README 顶上那行数字必须与代码一致
node scripts/certify-baseline.mjs   # 漏网的变异体必须正好是基线里那几个
node scripts/certify-can-fail.mjs   # 判据准入自己能被证伪
node scripts/kind-necessity.mjs     # 每种断言都得证明自己有用
node scripts/state-equivalence.mjs  # 快路径与重放必须逐格相同
node bin/agent-web.mjs selftest     # 内置适配器 + 内置案例
```

`status-line.mjs` 那条特别容易踩：它校验 `package.json` / `VERSION` / 两份 README 的 H1 与状态行 / `CHANGELOG.md` 首条 / tag，五处必须同一个版本号。**版本号的唯一来源是 `package.json`**，别在别处手写。

## 四种典型改动

### 加一种断言

1. 在 `src/assert/` 下实现，注册进 `src/assert/index.mjs` 的 `KINDS`；
2. 在 `docs/SPEC.md` 第 4 章写清它的语义、适用相位、可能返回的 `code`；
3. 在 `src/reasons.mjs` 的 `ASSERTION_CODES` 里登记它产出的每个码——**新增一个码 = 改两个地方**，`test/reasons.test.mjs` 双向查（没登记要红，登记了没产出也要红）；
4. 造一个**只有它能抓**的变异体，进 `docs/mutants/`；
5. 跑 `kind-necessity`，它必须报告"换得回东西"。

### 加一个变异体

变异体是"故意写坏的实现"，用来证明断言真的能抓到东西。`docs/mutants/` 下每个文件导出一个 `meta`，五个字段必填：

```js
export const meta = {
  id: 'm-something',
  title: '一句话说清它坏在哪',
  symptom: '用户会看到什么症状',
  mechanism: '代码里哪一步错了',
  catch_hint: '哪条断言应该抓到它，怎么抓',
  layer: 'state',          // state / execute / classify
  applies_to: { collections: ['orders'] },   // 见下
};
```

`applies_to` **不要省略**。省略等于"所有域都适用"，会把每个新域的分母撑大，让抓获率看起来低得多——这个坑已经踩过一次（v0.63.1）。跨域通病写空对象 `{}`，为的是跟"忘了写"区分开。

加完跑 `certify` 验证：`node bin/agent-web.mjs certify cases/coffee --adapter=memory`。新变异体应该出现在 `caught` 里；如果落进 `killable`（有可观测差异但没断言抓）或 `undetermined`（造不出差异），说明要么断言不够，要么这个变异体本身没意义。

### 加一个域

域的门槛是**两个独立实现 + `compare` 一致率 100%**。只有一份实现、没有 `compare` 的，不算"验过的域"（`cases/realworld` 和 `cases/labaccess` 就是这个状态，README 里因此仍写五个而不是七个）。

两个实现要真的独立：不同的存储结构、不同的排序规则、不同的计数器策略。抄一份改个名字不算——`compare` 存在的意义就是让两份实现互相证伪。

### 改文档

文档说"欠着"而实际已经做完，比"做了没说"更糟：它会让人重做一遍。所以改完代码必须同步这几处，都有测试守着：

- `docs/LIMITS.md` —— 11 条限制的台账，每条写状态、验收命令、为什么这条不解决；
- `docs/ROADMAP.md` —— 第 0 节的版本号与测试条数；
- `CHANGELOG.md` —— 首条必须与 `package.json` 一致，写"做了什么"和"因为什么"，不写"感觉怎么样"；
- `README.md` / `README.en.md` —— 两份必须同步，`test/readme-boundary.test.mjs` 会比对"已实现"那一节。

## 提交信息

```
type(scope): 一句话说清做了什么

为什么这么做。如果这次改动修掉的是一个"安静的错误"，
写清它为什么会安静——下一个人才不会重新犯。
```

`type` 用 `feat` / `fix` / `docs` / `test` / `chore`。scope 用模块名（`runner` / `certify` / `probe` / `contract`）。

**不要在提交信息里写"优化""完善""改进"。** 说清改了什么、为什么。

## AI 参与的规则

这个仓库是给 Agent 写测试的，所以**欢迎用 Agent 帮忙改**，但规则和别人不一样：

- **由 Agent 生成、没有任何人读过就提交的改动，不会被合并。** 你要能解释每一行改动为什么在那儿。审阅者会问，答不上来就是没读。
- **Agent 写的测试不算"独立验证"。** 一个断言如果只有它自己的作者觉得对，它还没有被验证过。
- **不要用 Agent 生成"看起来合理"的文档段落。** 这个仓库的文档是判据的一部分（`status-line.mjs` 会读它们），编出来的数字会直接让 CI 变红。

## 行为准则

见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。简短版：对事不对人，不接受人身攻击，不接受把"我只是在开玩笑"当免责声明。

## 安全问题

见 [SECURITY.md](SECURITY.md)。这个仓库的"安全"含义比较特殊——它测的是适配器会不会撒谎，所以"能让适配器骗过探针"的发现是有效漏洞，不是使用问题。

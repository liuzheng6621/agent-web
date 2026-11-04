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

## 判决只有三种

<p align="center">
  <img src="docs/media/verdicts.png" alt="pass / fail / unknown 三值判决" width="100%">
</p>

关键在 `unknown`：缺观测、缺能力、前置条件不成立的时候，它**不折算成 pass**，而是留在分母里。于是「测了多少」和「判了多少」是两件不同的事，指标里分别给：

```
可判定率 87.5% (7/8)   CI95[53%, 98%]
```

`unknown` 一多，可判定率就掉下来。这比一个漂亮的 100% 更能说明问题。

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

二十一条命令，按你手上有什么分三类。

**你有一个系统，想给它写测试**

| 命令 | 干什么 |
| --- | --- |
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
| `drill <目录> --out=DIR` | 出题：拿变异体当靶子 |
| `drill grade` | 批改：不看提交说什么，只看它杀了几个靶子 |
| `knowledge` / `recall` | 事故档案：记过的坑，第二次遇到拦下来 |
| `selftest` / `capabilities` / `flow` | 自测、能力清单、交互式流程图 |

## 几个设计选择

**没有 LLM 判定。** 断言是七种结构化谓词（`entity_exists`、`field_equals`、`count_delta`、`status_transition`、`unchanged`、`event_absent`、`relation`），求值结果是三值逻辑。判决过程不调用模型，所以同一份输入永远给出同一个判决。

**适配器把观测投影成同一份规范视图。** 字段映射写在适配器里，不写进案例。换一个实现时案例一个字都不用改——这是跨实现对照能成立的前提。

**「谁来做」是案例的一部分。** 每一步都写明 `as: customer2`，runner 会检查适配器有没有真的换了身份。身份被悄悄塌缩成同一个人的时候，判决可能照样是 pass，但证据里看得出来。这个坑叫 `FINDING-001`，抓它的不是三值逻辑，是跨实现对照。

**建议断言必须当场验证。** `--suggest` 给出的每一条，都会在正确实现和变异体上各跑一遍，两边结果符合预期才允许出现在报告里。没验过的建议等于没给。

## 现在做不到什么

按离真实使用最近排序。

1. **每个目标系统都要写一个适配器。** 适配器是代码，`load` 会直接 import 它——加载适配器等于以你的身份执行它。CLI 会先提示一次，但那只是提示，不是沙箱。
2. **字段映射靠人写。** 规范视图的映射是有意放在适配器里的，没有自动推导。
3. **只判合法性，不判质量。** 能说「这个流程合法」，说不出「这个流程走得好不好」。评价质量要引入打分，那是另一个东西。
4. **负例得人补。** `draft` 会把该写负例的地方列成待办，写不了：负例的判断标准是「应该允许什么」，照着实际发生的写等于当场放水。
5. **变异体只有十二个，都是我们想得到的。** 这是变异测试的根本局限。清单开源就是为了让别人补上「他们那份没想到」。
6. **等价变异体问题没有解决。** 只是把它变成了显式状态：杀不掉但造得出差异 → 欠账；连差异都造不出 → 说不清，要求给出证明。
7. **断言表达能力有限。** 七种谓词，写不出「这个列表按创建时间倒序且分页正确」这类组合约束。
8. **适配器可以撒谎。** 裁剪过的观测、假装的执行，`probe` 只能查六项机械性质，查不出故意造假。它保证的是「给定这份观测，判决是这么来的」。
9. **只在一个域上验证过。** 咖啡店：菜单、订单、状态机、两种角色。换个域大概率会暴露新的缺口。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/SPEC.md](docs/SPEC.md) | 格式规范：案例、断言、适配器契约、判决顺序表 |
| [docs/FINDING-001.md](docs/FINDING-001.md) | 一次假通过的全过程 |
| [docs/museum/](docs/museum/) | 六件失败展品，每件都能复现 |
| [docs/mutants/](docs/mutants/) | 十二个变异体，收稿标准在 README 里 |
| [docs/media/promo.mp4](docs/media/promo.mp4) | 四十二秒介绍片 |

## 许可

MIT。案例、变异体、事故档案都欢迎投稿——它们的价值本来就在数量上。

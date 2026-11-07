# 文档地图

每份文档只答一个问题。**按你此刻的问题挑入口**，不必通读；每条路径都被测试守着（`test/community-files.test.mjs` 会检查这里列出的文件都存在——地图不许腐烂）。

## 按问题分流

| 你此刻的问题 | 去哪 |
|---|---|
| 这工具是什么，适不适合我 | [README](../README.md) 的「三十秒判断」 |
| 怎么 3 分钟跑起来 | [GUIDE · 3 分钟试跑](GUIDE.md#3-分钟试跑)，或 README「六十秒上手」 |
| 手上有接口，怎么长出适配器和案例 | [GUIDE · 从一个网址开始](GUIDE.md#从一个网址开始) · [ADAPTER-GUIDE](ADAPTER-GUIDE.md) |
| 有现成接口测试套件（hurl），能不能直接用 | [GUIDE · 现成的案例从哪来](../README.md#现成的案例从哪来) 与 `import hurl` |
| 断言怎么写、有哪些、各管什么 | [SPEC 第 4 章](SPEC.md)（20 种断言） |
| 判决为什么是 unknown，unknown 去哪了 | [SPEC 第 7 章](SPEC.md)（判决顺序表）+ [LIMITS L8](LIMITS.md) |
| 它做不了什么、哪些永远做不了 | [LIMITS.md](LIMITS.md)（11 条台账，每条带验收命令） |
| 我要给这个仓库投稿（断言/变异体/域） | [CONTRIBUTING.md](../CONTRIBUTING.md) + [mutants 投稿标准](mutants/README.md) |
| 这个仓库踩过哪些坑 | [knowledge/](../knowledge/README.md)（事故档案）+ [museum/](museum/README.md)（12 件展品） |
| 我是 AI Agent，要改这个仓库 | [AGENTS.md](../AGENTS.md) 先行，再查 [SPEC](SPEC.md) |
| 发现了安全问题 | [SECURITY.md](../SECURITY.md) |

## 全部文档

| 路径 | 答什么 | 量级 |
|---|---|---|
| [README.md](../README.md) / [README.en.md](../README.en.md) | 是什么、怎么上手、边界在哪 | 中英各约 500 行 |
| [docs/GUIDE.md](GUIDE.md) | 怎么用：网址起步、录流量、判分、审计 | 约 1000 行 |
| [docs/SPEC.md](SPEC.md) | 规范唯一出处：案例、断言、判决、探针、命令 | 约 2000 行 |
| [docs/ADAPTER-GUIDE.md](ADAPTER-GUIDE.md) | 接自己的应用：三档路径、只改四处 | 129 行 |
| [docs/LIMITS.md](LIMITS.md) | L1–L11 台账：状态、验收命令、为什么 | 332 行 |
| [docs/ROADMAP.md](ROADMAP.md) | 路线图：做完什么、下一条怎么验收 | 288 行 |
| [CHANGELOG.md](../CHANGELOG.md) | 每个版本做了什么、因为什么 | 随版本增长 |
| [docs/domains/](domains/) | 四个域的实测细节 | 每域一份 |
| [docs/museum/](museum/README.md) | 假判决博物馆：12 件可运行的展品 | 每件一个 .mjs |
| [docs/mutants/](mutants/README.md) | 63 个变异体目录 + `applies_to` 约定 | 每体一个 .mjs |
| [knowledge/](../knowledge/README.md) | 14 条事故档案：症状、根因、判据 | 每条一份 |
| [docs/media/](media/) | 本仓库所有图与动图，全部本地生成 | 生成脚本在 `tools/media/` |

## 域文档（docs/domains/）

| 域 | 一句话 |
|---|---|
| [animal.md](domains/animal.md) | 流浪动物追踪：Spring 真实后端，抓出「审批接口没有角色检查」 |
| [lexicon.md](domains/lexicon.md) | 词库检索：900 条数据上翻页坏法才真的暴露 |
| [cron.md](domains/cron.md) | 定时任务：`recurrence` 断言的出处，`recurrence` 生成变异体的必要性反证 |
| [labaccess.md](domains/labaccess.md) | 实验室预约：时间窗 + 凭证签发的第六个真实后端（单实现，不计入「验过的域」） |

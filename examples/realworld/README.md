# RealWorld 语料：13 个套件转成案例

`realworld-apps/realworld`（原 `gothinkster/realworld`）是「同一份契约、上百个实现」的那个项目。
`specs/api/` 里除了 `openapi.yml`，还有两套能直接跑的断言套件：`hurl/`（13 个文件）和 `bruno/`。
本目录放的就是这两样东西的副本，以及我们用它造的适配器和案例。

```
openapi.yml              19 个端点的契约（留给 discover 用）
hurl/*.hurl              13 个套件：157 步、296 条断言
fake-server.mjs          零依赖的内存实现，19 个端点，跑在 8299
```

## 怎么跑

```bash
# 1. 起夹具（--allow-reset 打开 /_fixture/reset，重复跑同一批案例必须开）
node examples/realworld/fake-server.mjs 8299 --allow-reset &

# 2. 把套件转成案例（--as 是「谁在操作」，默认 user）
node bin/agent-web.mjs import hurl examples/realworld/hurl --out=cases/realworld --as=user

# 3. 确认（草稿不出判决）
for f in cases/realworld/*.json; do node bin/agent-web.mjs accept "$f" --by=你的名字; done

# 4. 出判决
node bin/agent-web.mjs verify cases/realworld --adapter=realworld --detail
```

## 当前状态（2026-11-05，v0.37.1）

| 指标 | 数字 |
|---|---|
| 套件 → 案例 | 13 |
| 步 | 157 |
| `payload` 断言 | 296 |
| 转不成断言的待办 | 94（favorites 24、feed 11、errors_comments 3、errors_articles 1） |
| `verify` 实测 | **pass 3 / fail 9 / unknown 1** |

`cases/realworld/expected.json` 里写的是**目标标签**（13 条全 `pass`），不是实测结果——
所以这个目录现在是一条红线：它把「我们的实现还没对齐契约」明明白白摆出来。
**因此它不进 CI**：CI 只跑 `cases/coffee` 与 `cases/animal` 的闸门。

## 十条红的分类（都是真差异，不是工具失灵）

| 类别 | 例 | 原因 |
|---|---|---|
| 夹具文案 | `$.errors.comment[0]` 期望 `forbidden`、实际 `is not yours` | 内存夹具的错误文案与参考实现不同 |
| 夹具缺字段 | `$.errors.article[0]` 期望 `not found`、实际 `undefined` | 未命中路由时回的是 `{route:[…]}` |
| 鉴权字段 | `$.errors.token[0]` 期望 `is missing`、实际 `undefined` | 部分路由没走「未登录」分支 |
| 多身份 | `articles.update 应被拒绝，实际被执行` | 套件用两个 token 操作两个人，角色绑定还没完全对上 |
| 计数口径 | `feed` 期望 1 条，实际 2 条 | 夹具的 `follows` 过滤与套件预期不一致 |
| 状态回读 | `favorited` 取消后仍为 `true` | 取消收藏那一步的执行者与查询者不是同一个人 |

## 这个目录证明了什么

一份第三方套件，**不写代码**就能变成 13 条案例、157 步、296 条断言，判决由我们自己的三值引擎给出。
红的部分不是「工具不行」，是「夹具还没长成契约的样子」——而这恰好是这套工具存在的理由：
它把「实现与契约的差距」变成可数的数字，而不是一句「应该差不多」。

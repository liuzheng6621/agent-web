# RealWorld 语料：一份契约，上百个实现

这里放的是 [realworld-apps/realworld](https://github.com/realworld-apps/realworld)（MIT）的
`specs/api/hurl/*.hurl`，用来演示 `agent-web import hurl` 能把现成的接口测试套件转成案例。

## 为什么是它

- **同一份契约有 990+ 个实现**（GitHub 搜 `realworld example app` 的仓库数），
  而 agent-web 的全部价值就是「一份案例打两个实现」——这个语料天生满足。
- 自带 **13 个 hurl 套件**（articles / auth / comments / favorites / feed / pagination /
  profiles / tags / 四份 errors_*），每个都是纯文本的请求 + 捕获 + 断言。
- 另有 `openapi.yml`，可以直接喂 `agent-web discover` 生成声明式适配器。

## 已经抓下来的

`hurl/` 下三份样张：`auth.hurl`、`pagination.hurl`、`tags.hurl`。

## 转成案例

```bash
agent-web import hurl examples/realworld/hurl --out=cases/realworld
```

实测：**31 步 / 74 条断言 / 0 处待办**（auth 20 步 60 条、pagination 7 步 8 条、tags 4 步 6 条）。

转出来的都是**未确认草稿**，`accept` 之后才能出判决。转换器只做能确定的事：
读不懂的断言会写进同目录的 `<名字>.todo.md`，不会悄悄丢掉，也不会猜。

## 还差什么

`adapter: 'realworld'` 目前没有内置适配器。要真跑起来，得先有：

```bash
agent-web discover <某个 RealWorld 实现的地址> --out=agent-web-site --run
```

或者照 `specs/api/openapi.yml` 手写一份 `adapter.yml`（声明式，不写代码）。
**这一步是这套语料唯一要人做的地方**——也是 `align` / `discover` 后续要压掉的那部分。

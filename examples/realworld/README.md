# 现成案例：把 RealWorld 的 hurl 套件转成 agent-web 案例

RealWorld（[realworld-apps/realworld](https://github.com/realworld-apps/realworld)，MIT）给的是
**一份契约 + 上百个实现 + 现成的断言套件**。这里用它的 `specs/api/hurl/*.hurl` 做语料，
用 `agent-web import hurl` 转成案例，再用 `src/adapter/realworld.mjs` 打它。

## 三步跑起来

```bash
# 1) 起一个实现（这里用仓库自带的内存夹具，零依赖）
node examples/realworld/fake-server.mjs 8299 --allow-reset

# 2) 把 hurl 套件转成案例（已随仓库提供，重转一次也行）
agent-web import hurl examples/realworld/hurl --out=cases/realworld --as=user
agent-web accept cases/realworld/auth.json --by=<你的名字>

# 3) 跑
agent-web probe  --adapter=realworld
agent-web verify cases/realworld --adapter=realworld
```

实测（本机，夹具在 8299）：`probe` 6/6 通过；`verify` **3/3 与预期一致**（auth / pagination / tags 全部 pass，
可判定率 100%）；转出来的是 31 步 / 74 条断言 / 0 处待办。

## 夹具与真后端的区别（别把夹具当证据）

`fake-server.mjs` 是本仓库写的**内存实现**，只为演示链路。它能证明的是「转换器 + 适配器 + 判决链路是通的」，
不能证明「某个 RealWorld 实现是对的」。要证明后者，把 `REALWORLD_BASE_URL` 指向一个真实现：

```bash
REALWORLD_BASE_URL=https://your-realworld-instance.example \
  node bin/agent-web.mjs verify cases/realworld --adapter=realworld
```

真后端上没有 `/_fixture/reset`，`reset()` 会退化成「按历史作者删文章 + 注册新的角色账号」；
同一条案例重复跑两次，注册类步骤会撞 422 —— 上游做法是每轮生成新的 `{{uid}}`，
所以重跑前请先 `import hurl --uid=<新值>` 重新生成案例。

## 这套语料的价值

- **断言是别人写的**：`jsonpath "$.user.bio" == null`、`count >= 1`、`isString` 这些不是我编的理想案例，
  是社区维护的契约断言；转进来以后本项目的判决器要接受真实世界的口味。
- **一份契约、上百个实现**：同一批案例可以打任意 RealWorld 实现，正是「跨实现对照」的天然场地。
- **换域就是换契约**：换 Cassandra/Petstore 之类契约只需要换 `openapi.yml` 与 hurl 套件，
  适配器那一层几乎不动（能力名由 `capabilityOf` 推导，参数名按资源定）。

## 还没做的

- 只转了 3 个套件（auth / pagination / tags）；`articles`、`comments`、`favorites`、`feed`、`profiles`
  与 5 个 `errors_*` 套件还没转（它们更大，也更依赖前置数据）。
- 这批案例目前没有配套变异体，所以 `certify` 对它们不产生「准入」结论 —— 变异体是按咖啡域写的，
  换域要另写（`docs/mutants/` 的投稿规则适用于任何域）。
- `import hurl` 不猜业务规则：断言只按 hurl 原文转，原文没写的就不写。

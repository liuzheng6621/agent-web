# RealWorld 十条红的修复计划（交给外部实现者的施工单）

> **状态：已完成（v0.46.0，commit `d001436`）。** 十条全部修完，`verify cases/realworld --adapter=realworld`
> 现在 **13/13 pass**，并已进 CI。这份文件保留为记录：它写清了当时每一条红的层级归属和
> 反向验证要求，后来动手时正是按这个顺序做的。若要再交给别人，请从「现状」重新跑一遍再改。

> 目标：`agent-web verify cases/realworld --adapter=realworld` 从 **pass 3 / fail 9 / unknown 1**
> 变成 **13/13 pass**，且**不许**通过改 `cases/realworld/*.json` 或 `expected.json` 来变绿。

## 0. 现场事实（动手前先自己复核一遍）

```bash
cd E:/SKIl.1/agent-web
node examples/realworld/fake-server.mjs 8299 --allow-reset &   # 夹具，必须带 --allow-reset
node bin/agent-web.mjs verify cases/realworld --adapter=realworld --detail
```

- 案例由 `node bin/agent-web.mjs import hurl examples/realworld/hurl --out=cases/realworld --as=user`
  从 RealWorld 官方的 13 个 `.hurl` 套件生成，**断言是 hurl 里写的，不是我们编的**。
- 适配器：`src/adapter/realworld.mjs`（19 个能力，角色 `anonymous` / `user` / `user2`）。
- 夹具：`examples/realworld/fake-server.mjs`（零依赖内存实现，`--allow-reset` 才会开 `POST /api/_fixture/reset`）。
- `cases/realworld/expected.json` 里写的是**目标标签**（13 条全 `pass`），所以这组案例**不在 CI 里**跑；
  它是进度条，不是现状。

## 1. 铁律（违反任何一条，这份活儿就算没做）

1. **先判断错在哪一层，再动手**。三层：① 转换器/适配器（`src/import-hurl.mjs`、`src/adapter/realworld.mjs`）
   ② 夹具（`examples/realworld/fake-server.mjs`）③ 契约确实没规定。改错层等于把 bug 焊死。
2. **不许改案例文件、不许改 `expected.json`、不许删断言**。案例是外部契约的转写，它红着有意义。
3. **每修一条都要能重新变红**：修完把那个故障人为塞回夹具（临时开关或注释一行），确认对应案例转红，
   再撤掉。验收证据里要带这条「反向验证」的输出。
4. **一条一提交**，提交信息写清「哪条案例、错在哪层、反向验证怎么做的」。
5. 夹具的响应文案以 **hurl 断言里出现的字符串为准**（`hurl/` 是这份契约的事实标准），不是以「看着合理」为准。

## 2. 十条红，按类归并

### A 类：转换器/适配器自己的 bug（不是夹具的问题）

**A1. `realworld/errors_articles` → `unknown`，能力 `some-slug.update` 不在 manifest**

- 现象：`coverage_gap：能力 some-slug.update 不在 manifest`。
- 根因：`src/import-hurl.mjs` 先把 `{{uid}}` 替换成字面量（`some-slug-000000`）**再**推能力名，
  于是「这一段是路径参数」的信息丢了，被当成资源名。
- 改法：**先推能力名、后做变量替换**；或替换时保留标记（例如替换成 `\u0001uid\u0001`，
  推导时仍认得出这是参数）。推导规则已有：含变量的段算参数、末段是动作词取前一段资源名。
- 验收：`errors_articles` 从 `unknown` 变 `pass`/`fail`（不再是 `coverage_gap`），
  且 `node bin/agent-web.mjs import hurl …` 的 `articles.update` 能力名不变。

**A2. `realworld/auth` → `user.get 被拒绝：http_401 user is not authenticated`**

- 现象：案例最后一步用改名后重新捕获的 token（hurl 的 `updated_token`）去 `GET /api/user`，被 401。
- 先查两处再动手：① `src/import-hurl.mjs` 的身份规则——`updated_token` 必须**继承**该步使用的角色
  （它不是新身份，是同一个人的新票根）；② 夹具在改名后是否把旧 token 作废了。
- 改法：若角色错 → 修身份继承；若夹具作废了 token → 夹具改名后**保留 token 有效**（RealWorld 规范如此）。
- 验收：`auth` 转 `pass`。

### B 类：夹具缺业务语义（最容易糊弄，最需要反向验证）

**B1. `realworld/favorites` — 第 7 步 `$.article.favorited` 期望 `false`，实际 `true`**

- 根因方向：夹具的「文章视图」没按**当前用户**算 `favorited`，而是全局算。
- 改法：`articleOf(art, viewer)` 里 `favorited = favorites.has(viewer + '|' + slug)`，收藏集按 `用户|slug` 存。
- 反向验证：把 `favorited` 改回全局算，`favorites` 必须转红。

**B2. `realworld/feed` — 第 8 步 `$.articles` 长度 2，期望 1**

- 根因：`GET /api/articles/feed` 返回了全部文章，没按「关注的人」过滤。
- 改法：feed = 当前用户 `following` 集合里那些作者的文章。
- 反向验证：去掉过滤，`feed` 必须转红。

**B3. `realworld/profiles` — 第 6 步 `$.profile.following` 期望 `false`，实际 `true`**

- 根因：与 B1 同源——`following` 没按当前用户算（或 unfollow 没删干净）。
- 改法：`profileOf(user, viewer).following = followers.has(viewer + '|' + username)`；
  `POST/DELETE /api/profiles/:username/follow` 只改这一条键。
- 反向验证：`following` 恒 `true`，`profiles` 必须转红。

### C 类：夹具的错误文案与契约不符（hurl 才是标准）

**C1. `realworld/errors_profiles` — `$.errors.token[0]` 期望 `"is missing"`，实际 `undefined`**

- 根因：受保护接口没带 `Authorization` 时，夹具直接回 401 空体；契约要求 `{errors:{token:['is missing']}}`。
- 改法：401 时统一回 `{ errors: { token: ['is missing'] } }`；token 非法回 `{ errors: { token: ['is invalid'] } }`。
- 反向验证：改回空体，`errors_profiles` 转红。

**C2. `realworld/errors_authorization` — `$.errors.comment[0]` 期望 `"forbidden"`，实际 `"is not yours"`**

- 改法：越权删别人的评论回 `{ errors: { comment: ['forbidden'] } }`（403）。
- 反向验证：改回 `is not yours`，该例转红。

**C3. `realworld/errors_comments` — 第 8 步 `$.errors.article[0]` 期望 `"not found"`，实际 `undefined`**

- 根因：向不存在的文章发评论，夹具回了评论级错误（或 404 空体），契约要求**文章级**错误。
- 改法：先查文章，查不到回 404 `{ errors: { article: ['not found'] } }`。
- 反向验证：直接进评论逻辑，该例转红。

### D 类：夹具缺唯一性/鉴权检查（两条「应被拒绝，实际被执行」）

**D1. `realworld/errors_auth` — `users.create 应被拒绝，实际被执行`**

- 根因：重复注册（同 username 或同 email）必须 422 `{ errors: { username: ['has already been taken'] } }`
  / `{ email: […] }`；夹具大概率只查了其中一个，或压根没查。
- 改法：两个都查，按 hurl 断言里的**字段名与大写原样**返回。
- 反向验证：去掉查重，该例转红。

**D2. `realworld/articles` — `articles.update 应被拒绝，实际被执行`**

- 根因方向（按可能性排）：① 夹具的作者比对用的是 slug 而不是 `username`；
  ② 案例那一步的角色是 `user2`，而适配器给 `user2` 发的是 `user` 的 token（身份映射错）。
- 先打印 `viewer.username` 与 `art.author` 再改，不要猜。
- 反向验证：把作者检查去掉，`articles` 转红。

## 3. 施工顺序（按「证明成本」排，不按编号）

1. **A1**（转换器，不影响别人）→ 2. **D1 / D2**（两条「应被拒绝」是最硬的语义）→
3. **C1 / C2 / C3**（文案，改一处跑一次）→ 4. **B1 / B3**（同一处 `favorited`/`following` 机制）→
5. **B2**（feed 依赖 following）→ 6. **A2**（最后，因为它可能牵动 token 生命周期）

每完成一步都跑一次全量，把 `pass` 数记在提交信息里：

```bash
node bin/agent-web.mjs verify cases/realworld --adapter=realworld 2>&1 | tail -8
```

进度参考：`3 → … → 13`。**中途任何一次「改完反而更少」都要停下来查，不要继续堆改动。**

## 4. 交付物

- 一个分支 / 一串小提交，每条带：改了哪层、对应哪条案例、反向验证命令与输出。
- 结束时贴一次完整的 `verify --detail`（13 条逐条 pass/fail）与 `node examples/realworld/fake-server.mjs` 的启动方式。
- 若某条判断为「契约确实没规定、案例本身写死了实现细节」，**不要改案例**，
  在提交信息里说明并把它列进 `examples/realworld/README.md` 的「六类归因」，由维护者决定。

## 5. 环境坑（会直接浪费你半天）

- **夹具必须每次重启**：`--allow-reset` 只开复位接口，历史数据仍在内存里；
  连跑两次容易看到「上一轮的残留」，症状是 index 0 断到别的行上。改完夹具就重启一次。
- 端口 8299；`netstat -ano | grep ":8299"` 取 PID 后 `taskkill //PID <PID> //F`。
- `git push | tail` 会把退出码换成 `tail` 的，判成败要 `> log 2>&1; echo $?`。
- 写文件用 `ops_bash` 的 heredoc，**单次超过约 8.7KB 会被静默截断**（退出码仍 0），要 `cat >>` 分块。
- `README.md` / `package.json` 是 CRLF，多行锚点用 `\n` 拼永远匹配不到，用行号或 `indexOf` 插入。
- 版本号四处联动（`package.json` / `VERSION` / 两份 README 状态行），`node scripts/status-line.mjs` 会查。

# 接入你自己的应用：适配器骨架

这个目录是一个**能直接跑**的适配器，业务是仓库出库单——和仓库自带的咖啡店毫无关系。

选一个不相干的业务是故意的：如果骨架长得像某个具体系统，你读它的时候会忍不住去套那个系统，而不是想自己的系统。

```bash
node bin/agent-web.mjs verify examples/adapter-template/cases \
  --adapter=./examples/adapter-template/warehouse-adapter.mjs
```

```
pass    warehouse/foreign-submit         ok
pass    warehouse/happy-path             ok
fail    warehouse/skip-approve           unexpected_rejection
unknown warehouse/unknown-capability     coverage_gap
```

四行输出覆盖了四种判决形态：正常通过、负例被正确挡下、负例漏挡（该挡没挡）、能力缺口。

---

## 适配器只有五个方法

```js
{
  manifest(),           // 你的系统有哪些能力
  reset({ seed }),      // 复位到可重放初态
  observe(runId),       // 读当前状态，投影成规范视图
  execute(runId, act),  // 执行一个动作
  close(runId),         // 清理
}
```

不到 200 行就能写完一个。真正的成本不在代码量，在**想清楚你的系统有哪些可观测状态**。

---

## 第一步：列能力，标证据等级

```js
capabilities: [
  { id: 'picking.create', kind: 'write', evidence_level: 'validated', roles: ['clerk'] },
  { id: 'stock.adjust',   kind: 'write', evidence_level: 'inferred',  roles: ['manager'] },
]
```

`evidence_level` 三档：

| 等级 | 含义 | 能干什么 |
| --- | --- | --- |
| `observed` | 只见过它的响应，没验证过副作用 | 可以跑，判决要打折看 |
| `inferred` | 从代码/文档推断，没实跑 | 同上 |
| `validated` | 实跑过，副作用确认 | 可以当判决依据 |

**没实现的能力就老实标 `inferred` 或不写。** 案例用到它会得到 `unknown / coverage_gap`——这是诚实的缺口。硬编一个假实现，缺口就变成假绿。

---

## 第二步：想清楚怎么复位

三条路，选最便宜的那条：

| 策略 | 适用 | 代价 |
| --- | --- | --- |
| `snapshot` | 状态在文件/内存里，能整份覆盖 | 最便宜 |
| `reseed` | 能重建 schema 并灌种子 | 中，要后端配合 |
| `identity` | 应用本来就有账号体系 | 最便宜，且能用在**别人的**生产级系统上 |

骨架用的是 `snapshot`（内存后端）。真实系统优先考虑 `identity`：每条案例用新账号，天然隔离，不用清库、不用回滚，也就不会误伤存量数据。

`reset()` 必须返回 `roleBindings`，且**必须单射**——不同角色绑到不同身份。两个角色指向同一个账号，等于让"换个身份再来一次"这类案例静默失效，判决还是绿的。运行器会检查这一点。

---

## 第三步：投影成规范视图

`observe()` 返回的对象就是断言能看见的全部世界。

```js
{
  stock:    [{ sku, name, onHand, reserved, available }],
  pickings: [{ id, sku, qty, status, owner }],
  events:   [{ id, type, pickingId, from, to, by, at }],
}
```

三条规矩：

1. **键名一旦定下来就别改。** 断言写在视图上，视图漂移等于断言漂移。
2. **事件流单独一个集合**，并在 manifest 里用 `events_scope` 指出来。`event_absent` 靠它判断"能不能断言某件事没发生"。
3. **别在视图里放账号、令牌、主机名。** 视图是给人写断言用的，不是 dump。

---

## 第四步：`execute` 里唯一容易错的事——身份

```js
const role = action.as ?? 'clerk';
const who = ctx.roleBindings[role];
```

身份**只来自案例的 `as`**。

骨架里有一行：

```js
if (action.as !== undefined && !ROLES.includes(action.as)) {
  return { outcome: 'rejected', error: { code: 'unknown_role', ... } };
}
```

不认识的角名直接拒绝，**不回落到默认身份**。

这不是洁癖。仓库自带的咖啡店适配器一开始就是按"走店员线还是顾客线"选令牌，把 `customer` 和 `customer2` 塌缩成了同一个人——于是"顾客 B 取走顾客 A 的咖啡"这条案例判了 `pass`，而它实际执行的是"顾客 A 取自己的咖啡"。

判决是真的，只是它测的不是它声称的那件事。这类 bug 不报错、不告警、不留痕迹，产出一个看起来完全正常的绿色。全文见 [docs/FINDING-001.md](../../docs/FINDING-001.md)。

---

## 第五步：把四种 outcome 分清楚

```
applied       动作被执行了
rejected      应用自己拒绝了（业务规则 / 权限 / 冲突）
unsupported   适配器演不了（覆盖缺口）
infra_error   适配器或下层故障
```

最容易犯的错是把 `unsupported` 当 `rejected`。那会让"我还没实现这个能力"被记成"应用拒绝了这个操作"，覆盖缺口消失，指标虚高。

反过来，把网络错误当 `rejected` 也一样：一次超时会让案例判 `fail`，然后你去改断言，越改越错。

---

## 换成真后端

骨架里 `createBackend()` 就是"你的系统"。把它换成 `fetch`，其余不动：

```js
async function call(method, path, { body, token } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
               ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}
```

然后：

- `reset()` 里调你的注册/建租户接口，拿三个身份
- `observe()` 里把你的列表接口映射成规范视图
- `execute()` 里每个 capability 落到一个 HTTP 调用
- 网络异常一律 `throw`，让外层归类成 `infra_error`，**不要**返回 `rejected`

完整范例见 [`src/adapter/taixianglian.mjs`](../../src/adapter/taixianglian.mjs)（约 11KB，一个真实 Spring Boot 后端的全量接线）。

---

## 一个建议

先只接**一个只读能力**，写一条案例，跑通。

跑通之后再写第一条写操作。第一版适配器最常见的失败不是写不出来，是贪多：一口气接十二个能力，然后发现 `observe` 的投影漏了两个字段，所有断言都是 `unknown`，还不知道该怪谁。

一条绿了的案例比十二条不知道对不对的强。

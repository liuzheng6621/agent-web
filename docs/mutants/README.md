# 变异体目录

这里放的不是测试，是**被测对象的替代品**：把正确实现复制一份，只在一个地方改坏。

`agent-web certify` 拿它去问每条断言一句话——**你能把它抓出来吗？**
抓不住的断言，就是该被拒收的断言。

## 一个变异体必须满足三条

1. **只坏一处。** 同时坏两处的变异体，抓不住的时候你不知道是哪一处没被盯住。
2. **表面上要像正常。** 不能把接口改崩、不能抛异常。真实 bug 通常长这样：
   返回值形状完全正确，只是一个数字不对、一条日志缺了、一个身份换了。
3. **说清怎么抓。** 写不出 `catch_hint`，说明这个变异体本身还没想明白。

## 文件格式

```js
import { wrapState } from './_helpers.mjs';

export const meta = {
  id: 'm-some-thing',        // 必须与文件名一致，形如 m-kebab-case
  title: '一句话名字',
  layer: 'state',            // state（只改观测）| execute（改动作结局）
  symptom: '用户投诉长什么样',
  mechanism: '具体改了什么',
  catch_hint: '什么样的断言能抓住它；什么样的抓不住',
  applies_to: {                 // 可选：这个变异体只对哪些适配器有意义
    capabilities: ['order.cancel'], // 能力不在适配器里 = 不适用（certify 不计入分母）
    collections: ['orders'],        // 两个都能省略；全空 = 所有域都适用
  },
};

export function wrap(adapter) {
  return wrapState(adapter, (state) => { /* 只改这里 */ });
}
```

三个包装器（`_helpers.mjs`），别自己动适配器内部状态：

| 包装器 | 改什么 | 对应哪类 bug |
| --- | --- | --- |
| `wrapState` | `observe()` 返回的规范视图 | 算错了、过滤漏了、日志丢了 |
| `wrapExecute` | 执行前的请求（换身份、换参数） | 越权、参数被吞 |
| `wrapExecuteAfter` | 执行后的结局（该拒的改成成功） | 校验被注释掉 |

## 现在的清单

| id | 层 | 坏在哪 |
| --- | --- | --- |
| `m-money-off-by-cent` | state | 金额少一分 |
| `m-status-frozen` | state | 状态永远停在初始值 |
| `m-history-empty` | state | 事件流水被吞 |
| `m-extra-foreign-order` | state | 列表混进别人的订单 |
| `m-foreign-write-allowed` | execute | 越权写被放行 |
| `m-no-reject` | execute | 该拒的不拒 |
| `m-item-count-flattened` | state | 明细数量被拍平成 1，金额还是对的 |
| `m-pickup-no-offset` | state | 取餐号直接等于订单号 |
| `m-total-single-unit` | state | 总额漏乘数量 |
| `m-subtotal-stale` | state | 明细小计漏乘数量，总额却是对的 |
| `m-cancel-noop` | execute | 取消返回成功，状态一动不动 |
| `m-double-create` | execute | 下单被执行两次（没有幂等） |
| `m-duplicate-row` | state | 末行被第一行覆盖，条数不变 |
| `m-stringly-total` | state | 总额变成字符串 |
| `m-status-off-enum` | state | 状态跳出枚举 |
| `m-unsorted-orders` | state | 列表顺序反了 |
| `m-read-with-side-effect` | execute | 读操作偷偷写了一条 |
| `m-skip-intermediate` | execute | 两步迁移压成一步，终态对、序列错 |
| `m-double-effect` | execute | 一次操作记两遍账 |
| `m-ledger-sign-flip` | state | 负余额的符号被翻正 |
| `m-ledger-total-lies` | state | 交易合计说成非零（装平） |
| `m-ledger-any-balance` | execute | 不平的账也报成功（接口撒谎） |
| `m-lab-slot-conflict-ignore` | execute | 同一时段约两次都成功（时段排他没判） |
| `m-lab-otp-window-ignore` | execute | 时段没到就发门禁口令（时间窗没判） |
| `m-lab-borrow-stock-frozen` | state | 可借数量永远等于总量（借出不扣库存） |
| `m-lab-approve-not-pending` | execute | 已经批过的还能再批（批准没查状态） |
| `m-cron-skip-slot` | state | 每第 4 个槽位静默漏跑 |
| `m-cron-double-fire` | state | 同一槽位记录出现两次（游标没随提交前进） |
| `m-cron-drift` | state | 每个槽位都晚 20 分钟：次数全对、时刻全错 |

看完整说明：`agent-web mutants`。

**现在的战绩：咖啡域 17/19，账本域 4/5，实验室域 7/20，定时任务域 4/19。** 目录共 63 个变异体，其中 47 个声明了
`applies_to`——账本变异体在咖啡适配器上标记「不适用」，不进分母。 漏网的两个都记在 `scripts/certify-baseline.mjs` 的
`KNOWN_SURVIVORS` 里，理由分别是「取餐号的 +100 偏移是各实现自有的约定」和
「排序本来就没写进契约」——都不是尺子不够长，是这两样东西不该跨实现断言。

实验室域的分母要打个折看：20 个里有 13 个是咖啡域专用的老变异体，它们**没声明 `applies_to`**，
工具只能按「适用」算——那些变异体在实验室适配器上连差异都造不出来（清单末尾那句
「先确认案例走没走到」，说的就是这个坑）。真正与本域相关的 7 个，全被抓住：
预约时段排他、门禁口令时间窗、库存扣减、批准状态机各一个，外加三个跨域的通病
（`m-no-reject` 该拒的不拒、`m-exec-role-ignore` 身份塌缩、`m-exec-drop-intermediate` 丢中间态）。
这 13 个老变异体缺 `applies_to` 是笔明账，补它是独立的活儿。

定时任务域同样打折：适用 19 里只有 3 个是本域的（`m-cron-*`），加上 `m-exec-duplicate-write`
这个跨域通病共抓到 4 个。**这里有一个真结论**：`m-cron-drift`（每个槽位都晚 20 分钟）
只有 `recurrence` 抓得住——摘掉这条断言，它就从 caught 掉回 killable（有差异、没断言）。
`scripts/kind-necessity.mjs` 就是靠它判「第 20 种断言是否必要」的。

新加的三个执行层变异体各自钉住了一种断言：`m-read-with-side-effect` 只有 `unchanged` 抓得住，
`m-skip-intermediate` 靠 `status_transition` 的完整序列，`m-double-effect` 靠一条针对
具体事件类型的 `count_delta`。换句话说是这三个变异体在替那三种断言作证。

## 需要步号的那一类（`requires_trace`）

有两个变异体不是「改观测」，是「只改中间那一步」—— 中途坏、结尾修好，或者被拒绝之后留半条记录再抹掉。
它们靠 `tamper(state, index, count)` 里的**下标**下药，而 `observe` 包装拿不到步号，
所以只在 certify 的快路径（从 P⁺ 的 ctx 变换）里复现，重放路径复现不出来。

meta 里写 `requires_trace: true` 就是声明这件事，`scripts/state-equivalence.mjs` 会跳过它们并把跳过数量打出来。
不写这个标记，等价性门会看到「重放没坏、变换坏了」而报不一致 —— 那不是快路径错了，是这类变异体跨不过两条路径。

## 收稿标准

收一个变异体，要先回答这四个问题：

1. **它对应哪种真实故障？** 编不出来就别收——变异体的价值是"这是真会发生的坏法"。
2. **谁抓住它？** 跑 `agent-web certify cases/<你的案例> --mutations=<新 id>`，给出结果。
3. **它和现有 59 个是不是同一个？** 两个变异体只有 id 不同，等于把一张票投了两遍。
4. **有没有案例抓不住它？** 有，就写进 README 的"已知盲区"，别假装没有。

## 边界

- 这份清单**只覆盖想到的坏法**。它证明不了案例是对的，只证明"这些坏法有人管"。
- 清单本身要被审。加了变异体却没加案例，等于把标准降低了一点——所以每次改动都要跑
  `npm test` 与 `node scripts/certify-can-fail.mjs`（后者验证 certify 自己还能判红）。
- 变异体不追求覆盖语言/框架的所有出错方式，只追求**每一条都能对上一种真事故**。

## 用 `wrapState` 写的变异体会被免重放

`wrapState(adapter, tamper)` 会把 tamper 挂在返回对象的 `_agentWebStateFn` 上。certify 看到这个字段、且 `meta.layer === 'state'`，就不重放轨迹了——直接把正确实现的 ctx 复制一份、逐快照应用 tamper（见 SPEC 12.10）。

所以：

- **能写成 `wrapState` 的尽量写成 `wrapState`**。只改观测的坏法本来就不该重跑业务流程，真实后端上这是 3 倍的时间差。
- **tamper 必须是纯函数**。它会被调用多次（初态、每个中间快照、终态），带隐藏状态就会给出前后不一致的视图——那时 certify 的结果不可信，而且不会有任何报错。这一条是硬要求，不是风格建议。
- **改了执行过程的坏法不能走这条路**（换身份、让非法操作成功、读也写）。它们必须用 `wrapExecute`，certify 会老老实实重放。

## 漂移不会被当成见证

每条案例 certify 都会先把正确实现跑两遍，两次之间本来就不一样的字段（自增 id、时间戳、取餐号、操作人）记成漂移集，从见证里剔除。

这条规则对投稿的意义：**别指望"编号变了一下"能算你抓住了东西**。如果你的变异体唯一的可观测差异落在这些字段上，它会被判成「说不清」——因为换个实现、换一次运行，这个差异自己就变了。

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

看完整说明：`agent-web mutants`。

## 收稿标准

收一个变异体，要先回答这四个问题：

1. **它对应哪种真实故障？** 编不出来就别收——变异体的价值是"这是真会发生的坏法"。
2. **谁抓住它？** 跑 `agent-web certify cases/<你的案例> --mutations=<新 id>`，给出结果。
3. **它和现有六个是不是同一个？** 两个变异体只有 id 不同，等于把一张票投了两遍。
4. **有没有案例抓不住它？** 有，就写进 README 的"已知盲区"，别假装没有。

## 边界

- 这份清单**只覆盖想到的坏法**。它证明不了案例是对的，只证明"这些坏法有人管"。
- 清单本身要被审。加了变异体却没加案例，等于把标准降低了一点——所以每次改动都要跑
  `npm test` 与 `node scripts/certify-can-fail.mjs`（后者验证 certify 自己还能判红）。
- 变异体不追求覆盖语言/框架的所有出错方式，只追求**每一条都能对上一种真事故**。

# 两份提交，同一批题

这两份提交是用来验证批改器本身的。它们证明的是**批改器分得开好坏**，不是"我写得好"。

```bash
# 出题（题目落在 drills/，已被 .gitignore 忽略，因为它是生成物）
node bin/agent-web.mjs drill cases/coffee --adapter=memory

# 好提交：每条断言都盯着一个具体的值
node bin/agent-web.mjs drill grade drills --submissions=examples/drills/good
#   → 解出 9 / 可批改 9 → 100.0%   退出码 0

# 偷懒提交：把案例里原本就有的断言抄一遍
node bin/agent-web.mjs drill grade drills --submissions=examples/drills/lazy
#   → 解出 0 / 可批改 9 → 0.0%
#     没抓到 … 断言在正确实现上成立，在这份坏实现上也成立 —— 它看不见这个故障
#   退出码 1
```

`lazy/` 值得单独看一眼：**它交的断言全是真断言**——在正确实现上为真，在坏实现上也真。
从"我写了断言"的角度看，它不是乱写；从"我抓到故障"的角度看，它一分没有。
这个区别没法靠读代码看出来，只能靠跑。

文件名就是题目 id 的安全形式：`/` → `__`，`@` → `-at-`。

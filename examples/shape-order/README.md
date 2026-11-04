# 排序断言为什么不进共享案例集

`order.json` 里有 `sorted_by`，但它**故意留在这里**，没有进 `cases/coffee/`。

原因是一次实测：

```
memory 适配器          → pass
真实咖啡店后端 (8180)  → fail
  └ 没有按 createTime 升序：第 0 行 "…25.878566"，第 1 行 "…25.796938"
```

真实后端的列表是**新的在前**，mock 是**旧的在前**。两边的接口文档都没写顺序是什么。

这时候断言「升序」不是发现了一个 bug，是**自己造了一个假红**：换任何一个实现都可能红，
而红的理由跟对错无关，只跟你碰巧先写了哪一边有关。

这和 `m-pickup-no-offset`（取餐号偏移 100）是同一类东西：**能被观测到，不等于值得被断言**。

所以这个案例留在 `examples/` 下，只对 `memory` 跑，当作 `sorted_by` 的用法示范：

```bash
node bin/agent-web.mjs verify examples/shape-order --adapter=memory
```

真正的共享案例集里只放两边都成立的形状：唯一性、类型、值域（见 `cases/coffee/shape.json`）。

如果哪天两边都把顺序写进了契约，把它搬进 `cases/coffee/` 就行 —— 那时它才是断言，之前只是巧合。

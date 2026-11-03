# FINDING-001：适配器把两个身份塌缩成一个，越权案例假通过

严重程度：**高**（判决为 pass，但从未测试它声称要测的行为）
状态：已修复
发现方式：跨适配器判决对照（`agent-web compare`）

---

## 1. 现象

第一次把七条案例打到真实 Spring Boot 后端，`foreign-pickup` 判 `pass`。

这条案例的意图很清楚：

1. 顾客 A 下单
2. 店员接单
3. 店员出餐
4. **顾客 B 去取**

期望 `fail`——别人不能取走你的咖啡。同一份案例在内存适配器上确实判 `fail`（`not_owner`）。到了真实后端，它过了。

第一反应是后端有越权。真去看了，不是。

---

## 2. 排查

### 2.1 读后端

`OrderFlowService.transition()` 第一件事就是取可见订单：

```java
public OrderVO transition(Long orderId, OrderStatus target, String note) {
    UserContext.CurrentUser user = UserContext.require();
    Order order = loadVisible(orderId, user);
    ...
}
```

```java
private Order loadVisible(Long orderId, UserContext.CurrentUser user) {
    Order order = orderRepository.findById(orderId)
            .orElseThrow(() -> new BusinessException(ErrorCodeEnum.ORDER_NOT_FOUND));
    if (!user.isStaff() && !user.userId().equals(order.getUserId())) {
        throw new BusinessException(ErrorCodeEnum.ORDER_NOT_FOUND);
    }
    return order;
}
```

干净。非店员且不是本人 → `40402`。

### 2.2 绕过框架直接打

不看适配器，直接拿两个账号用 HTTP 打一遍：

```
register: 200 200
create:   200 order 10 PENDING
accept:   200
ready :   200
>>> B 取 A 的订单 => 40402 订单不存在
>>> A 读自己的订单 => 200 READY
```

后端是对的。B 被挡下了，A 的单还停在 READY。

那问题在测量侧。

### 2.3 找到那一行

```js
const route = ACTION_ROUTES[action.capability];
if (route) {
  const token = route.who === 'staff' ? ctx.staff.token : ctx.customer.token;
  ...
}
```

适配器按"这条能力走店员线还是顾客线"来选令牌，**完全忽略了案例里写的 `as`**。

案例说 `as: "customer2"`，实际发出去的还是 `customer` 的令牌。于是"B 去取 A 的单"被悄悄执行成了"A 去取 A 的单"，当然成功。

判决 `pass` 是真的。只是它测的不是案例声称的那件事。

---

## 3. 为什么这是最危险的一类 bug

它不报错、不告警、不留痕迹。它产出一个**看起来完全正常的绿色**。

对比三种失败：

| 失败类型 | 表现 | 危险程度 |
| --- | --- | --- |
| 断言写错，判 fail | 红色，人来查 | 低。噪音，会被看见 |
| 环境挂掉 | unknown，进未知率 | 低。指标会动 |
| **测量对象被替换** | **pass，一切正常** | **高。污染的是结论本身** |

前两种会被发现，第三种会一直绿下去，直到某天有人真的越权取了别人的咖啡。

---

## 4. 是什么抓住了它

不是三值逻辑。三值逻辑在这一条上给的也是 `pass`——从测量结果看，它确实是确定的成功。

抓住它的是**跨实现对照**：

```
案例                          memory        taixianglian  判决一致
memory/foreign-pickup        fail          pass          ✗ fail vs pass
```

同一份案例，两个独立实现，判决翻了。

这构成一个硬矛盾：要么后端有越权（后面查了，没有），要么测量侧撒谎。两者必居其一，而矛盾本身不需要任何模型来判断。

**结论：单适配器的断言集永远无法自证。** 一个坏掉的适配器配一套正确的断言，会稳定地输出错误的绿色；而它自己没有任何机制能发现这件事。必须有一个独立的第二实现来反驳它。

这就是为什么 `compare` 不是演示功能，而是核心功能。

---

## 5. 修复

```js
// 必须用 who.token：route.who 只说明走哪条业务线（店员线/顾客线），
// 不说明具体是谁。曾经这里写死 ctx.customer.token，把 customer2 塌缩成
// customer，越权案例因此假通过——身份必须由案例的 as 决定。
const token = who.token;
```

`who` 由案例的 `as` 经角色映射解析出来：

```js
const AS = { staff: ctx.staff, customer2: ctx.customer2, customer: ctx.customer };
const who = AS[action.as] ?? ctx.customer;
```

顺手修了同源的 `order.create`：它也写死了 `ctx.customer.token`，意味着 `as: "customer2"` 下单会被记在 A 名下。

修复后七条全对：

```
memory/foreign-pickup        fail          fail          ✓
跨适配器判决一致率 100.0% (7/7)
```

---

## 6. 一般化：写适配器时的四条硬规则

1. **身份只来自案例的 `as`。** 任何分支里出现写死的身份（`ctx.customer`、`ctx.staff`）都是 bug 候选，除非该能力在 manifest 里声明了只属于单一角色。
2. **角色 → 身份必须是单射。** `customer` 和 `customer2` 指向同一个真实账号，等于删掉了这条案例。`reset()` 必须返回 `roleBindings`，运行器检查这一点（`invalid_environment`）。
3. **`as` 的角色必须在 manifest 的 `roles` 里。** 案例用了适配器不认识的角色，应当报错，而不是回落到默认身份。
4. **回落默认值是危险的默认行为。** `AS[action.as] ?? ctx.customer` 里的 `??` 让拼错角色名静默变成"用主顾客"，是这次问题的同伙。应当改成找不到就 `rejected / unknown_role`。

第 2、3、4 条现已强制：`reset()` 返回 `roleBindings`，运行器检查单射；`as` 不在 `manifest.roles` 里时适配器直接 `rejected / unknown_role`，回落默认身份的那行 `??` 已经不用了。对应回归测试见 `test/engine.test.mjs` 末尾四条。

---

## 7. 最小复现

后端需在 `127.0.0.1:8180` 运行（`java -jar target/taixianglian-0.0.1-SNAPSHOT.jar --server.port=8180`）。

```bash
# 修复后：两侧一致，全部 fail
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8180 \
  node bin/agent-web.mjs compare cases/memory-demo --adapters=memory,taixianglian

# 回退那一行（把 who.token 改回按 route.who 选令牌）后重跑：
#   memory=fail taixianglian=pass   → 不一致率 85.7%
```

这条对照本身就是回归测试：只要有人在适配器里再把身份写死，`compare` 立刻翻红。

---

## 8. 一句话

> 一个绿色的判决证明不了什么，除非你能用另一个独立实现把它复现出来。

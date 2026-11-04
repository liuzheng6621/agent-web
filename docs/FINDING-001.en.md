# FINDING-001: the adapter collapsed two identities into one, and a privilege-escalation case passed

Severity: **high** (verdict `pass`, but the behaviour it claimed to test was never exercised)
Status: fixed
Found by: cross-adapter verdict comparison (`agent-web compare`)

[中文](FINDING-001.md) · **English**

---

## 1. Symptom

The first time the seven cases hit the real Spring Boot backend, `foreign-pickup` came back `pass`.

The case's intent is unambiguous:

1. Customer A places an order
2. Staff accepts it
3. Staff marks it ready
4. **Customer B comes to pick it up**

Expected `fail` — nobody else gets to walk off with your coffee. The same case correctly returned `fail` (`not_owner`) on the in-memory adapter. Against the real backend, it passed.

The first instinct was broken access control in the backend. I went and looked. It wasn't.

---

## 2. Investigation

### 2.1 Read the backend

The first thing `OrderFlowService.transition()` does is load the order through a visibility check:

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

Clean. Not staff and not the owner → `40402`.

### 2.2 Go around the framework and hit it directly

Skip the adapter entirely, take two accounts, and drive it over raw HTTP:

```
register: 200 200
create:   200 order 10 PENDING
accept:   200
ready :   200
>>> B picks A's order => 40402 order not found
>>> A reads own order  => 200 READY
```

The backend is correct. B was blocked, and A's order is still sitting at READY.

So the problem is on the measurement side.

### 2.3 Find the line

```js
const route = ACTION_ROUTES[action.capability];
if (route) {
  const token = route.who === 'staff' ? ctx.staff.token : ctx.customer.token;
  ...
}
```

The adapter picked a token by "does this capability run down the staff lane or the customer lane", **ignoring the `as` written in the case entirely**.

The case said `as: "customer2"`. What actually went out was `customer`'s token. So "B picks up A's order" was silently executed as "A picks up A's order" — which of course succeeds.

The `pass` was genuine. It just wasn't testing the thing the case claimed to test.

---

## 3. Why this is the most dangerous class of bug

It doesn't error. It doesn't warn. It leaves no trace. It produces a **completely normal-looking green**.

Compare three kinds of failure:

| Failure type | Appearance | Danger |
| --- | --- | --- |
| Wrong assertion, verdict `fail` | Red, a human investigates | Low. Noise, but visible |
| Environment down | `unknown`, lands in the unknown rate | Low. The metric moves |
| **Measurement target substituted** | **`pass`, everything normal** | **High. It contaminates the conclusion itself** |

The first two get found. The third stays green until one day somebody actually walks off with someone else's coffee.

---

## 4. What caught it

Not three-valued logic. On this case it also returned `pass` — from the measurement's point of view, the success was certain.

What caught it was **cross-implementation comparison**:

```
case                          memory        taixianglian  agree
memory/foreign-pickup        fail          pass          ✗ fail vs pass
```

One case, two independent implementations, verdicts flipped.

That is a hard contradiction: either the backend has broken access control (checked, it doesn't), or the measurement side is lying. One of the two, and the contradiction itself needs no model to detect.

**Conclusion: a single-adapter assertion set can never validate itself.** A broken adapter paired with a correct assertion set will reliably emit the wrong green, and it has no internal mechanism that could notice. An independent second implementation has to contradict it.

That is why `compare` is not a demo feature but the core one.

---

## 5. The fix

```js
// Must use who.token: route.who only says which business lane this runs down
// (staff lane / customer lane), not who is acting. This line used to hardcode
// ctx.customer.token, collapsing customer2 into customer, which made the
// privilege-escalation case pass falsely — identity must come from the case's `as`.
const token = who.token;
```

`who` is resolved from the case's `as` through the role map:

```js
const AS = { staff: ctx.staff, customer2: ctx.customer2, customer: ctx.customer };
const who = AS[action.as] ?? ctx.customer;
```

The same defect in `order.create` was fixed alongside it: it also hardcoded `ctx.customer.token`, meaning an `as: "customer2"` order would have been recorded under A.

After the fix, all seven agree:

```
memory/foreign-pickup        fail          fail          ✓
cross-adapter verdict agreement 100.0% (7/7)
```

---

## 6. Generalised: four hard rules for writing adapters

1. **Identity comes only from the case's `as`.** Any branch containing a hardcoded identity (`ctx.customer`, `ctx.staff`) is a bug candidate, unless the capability is declared single-role in the manifest.
2. **Role → identity must be injective.** `customer` and `customer2` pointing at the same real account deletes that case. `reset()` must return `roleBindings` and the runner checks this (`invalid_environment`).
3. **The `as` role must be in the manifest's `roles`.** A case using a role the adapter doesn't know should error, not fall back to a default identity.
4. **Falling back to a default is dangerous by default.** The `??` in `AS[action.as] ?? ctx.customer` let a typo'd role silently become "use the primary customer". That was this bug's accomplice. It should be `rejected / unknown_role`.

Rules 2, 3 and 4 are now enforced: `reset()` returns `roleBindings`, the runner checks injectivity, and a role outside `manifest.roles` makes the adapter return `rejected / unknown_role`. The fallback line no longer exists. Regression tests are at the end of `test/engine.test.mjs`.

---

## 7. Minimal reproduction

The backend needs to be running on `127.0.0.1:8180` (`java -jar target/taixianglian-0.0.1-SNAPSHOT.jar --server.port=8180`).

```bash
# After the fix: both sides agree, every case fails as expected
TAIXIANGLIAN_BASE_URL=http://127.0.0.1:8180 \
  node bin/agent-web.mjs compare cases/coffee --adapters=memory,taixianglian

# Revert that one line (pick the token by route.who again) and rerun:
#   memory=fail taixianglian=pass   → 85.7% disagreement
```

That comparison is itself the regression test: the moment anyone hardcodes an identity in an adapter again, `compare` goes red.

---

## 8. In one line

> A green verdict proves nothing unless you can reproduce it with another independent implementation.

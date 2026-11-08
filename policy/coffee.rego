package coffee

import future.keywords.in
import future.keywords.every
import future.keywords.if

# 咖啡店业务规则的独立副本（第二声明）。
#
# 这份 Rego 不是从 Java 翻译来的，是按 docs/domains/coffee.md 与
# policy/DECISIONS.md 里记的规则**重新写一遍**。两份独立声明互相对照，
# 任何一边漂了，另一边的 fixture 会红。
#
# 输入：一条事件序列（订单快照 + 状态流水），见 policy/fixtures/README.md。
# 输出：deny[] 为空即 allow。每条 deny 带规则号，便于定位是哪条规则拦下的。

legal_edges := [
	["PENDING", "MAKING"],
	["PENDING", "CANCELED"],
	["MAKING", "READY"],
	["READY", "PICKED"],
]

terminal := {"PICKED", "CANCELED"}

# R1 迁移合法性：每个事件必须是一条合法边；首事件必须是 null -> PENDING
deny[msg] {
	not start_ok
	msg := "R1 首事件必须是 null -> PENDING"
}

deny[msg] {
	e := input.events[_]
	not is_start(e)
	not legal_edge(e.from, e.to)
	msg := sprintf("R1 非法迁移 %v -> %v（订单 %v）", [e.from, e.to, e.orderId])
}

legal_edge(from, to) {
	legal_edges[i][0] == from
	legal_edges[i][1] == to
}

# R2 终态不可离开
deny[msg] {
	e := input.events[_]
	not is_start(e)
	terminal[e.from]
	msg := sprintf("R2 终态 %v 不能再迁移到 %v（订单 %v）", [e.from, e.to, e.orderId])
}

# R3 角色权限：店员可走任意合法边；顾客只能 -> CANCELED 或 -> PICKED
deny[msg] {
	e := input.events[_]
	not is_start(e)
	e.operatorRole == "CUSTOMER"
	not e.to == "CANCELED"
	not e.to == "PICKED"
	msg := sprintf("R3 顾客不能把订单推到 %v（订单 %v）", [e.to, e.orderId])
}

deny[msg] {
	e := input.events[_]
	not is_start(e)
	not known_role(e.operatorRole)
	msg := sprintf("R3 未知角色 %v（订单 %v）", [e.operatorRole, e.orderId])
}

# R4 链条连续：同一订单的相邻事件必须首尾相接
deny[msg] {
	seq := chain[oid]
	i := numbers.range(1, count(seq) - 1)[_]
	seq[i].from != seq[i - 1].to
	msg := sprintf("R4 订单 %v 的流水断了：第 %d 条 from=%v，上一条 to=%v", [oid, i, seq[i].from, seq[i - 1].to])
}

# R5 金额对账：订单总额必须等于明细小计之和
deny[msg] {
	o := input.orders[_]
	sum := sum_of(o)
	sum != o.totalAmount
	msg := sprintf("R5 订单 %v 总额 %v != 明细合计 %v", [o.id, o.totalAmount, sum])
}

# R6 明细自洽：小计 = 单价 × 份数，份数在 1..99
deny[msg] {
	o := input.orders[_]
	it := o.items[_]
	it.subTotal != it.unitPrice * it.count
	msg := sprintf("R6 订单 %v 的「%v」小计 %v != %v × %v", [o.id, it.dishName, it.subTotal, it.unitPrice, it.count])
}

deny[msg] {
	o := input.orders[_]
	it := o.items[_]
	not it.count >= 1
	msg := sprintf("R6 订单 %v 的「%v」份数 %v < 1", [o.id, it.dishName, it.count])
}

deny[msg] {
	o := input.orders[_]
	it := o.items[_]
	it.count > 99
	msg := sprintf("R6 订单 %v 的「%v」份数 %v > 99", [o.id, it.dishName, it.count])
}

# R7 属主：顾客的事件只能落在自己的订单上（防越权与 id 枚举）。
# 注意不跳过首事件 —— 下单本身就是「顾客对订单的第一次动作」，
# 跳过它等于允许「替别人下单」，实测这条一开始就漏了这个 case。
deny[msg] {
	e := input.events[_]
	e.operatorRole == "CUSTOMER"
	o := input.orders[_]
	o.id == e.orderId
	o.userId != e.operatorId
	msg := sprintf("R7 顾客 %v 动了订单 %v（属主 %v）", [e.operatorId, o.id, o.userId])
}

# R8 系统只能取消待接单
deny[msg] {
	e := input.events[_]
	not is_start(e)
	e.operatorRole == "SYSTEM"
	[e.from, e.to] != ["PENDING", "CANCELED"]
	msg := sprintf("R8 系统只能取消待接单，实际 %v -> %v（订单 %v）", [e.from, e.to, e.orderId])
}

is_start(e) {
	e.from == null
}

known_role(r) {
	r == "STAFF"
}

known_role(r) {
	r == "CUSTOMER"
}

known_role(r) {
	r == "SYSTEM"
}

start_ok {
	every_order_has_start
}

every_order_has_start {
	every seq in [s | s := chain[_]] {
		is_start(seq[0])
	}
}

# 按 at 升序重排同一订单的事件。Rego 的 sort 只吃字符串，
# 所以拼成 "at|index" 排序再取回原下标（at 里不含 "|"）。
chain := c {
	ids := {oid | some e in input.events; oid := e.orderId}
	c := {oid: sorted |
		oid := ids[_]
		raw := [e | some ev in input.events; ev.orderId == oid; e := ev]
		sorted := sort_by_at(raw)
	}
}

sort_by_at(events) = sorted {
	keys := sort([sprintf("%s|%d", [e.at, i]) | some i, e in events])
	sorted := [e |
		some k in keys
		parts := split(k, "|")
		i := to_number(parts[count(parts) - 1])
		e := events[i]
	]
}

sum_of(o) = s {
	xs := [it.subTotal | it := o.items[_]]
	s := sum(xs)
}

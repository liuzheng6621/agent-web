// 造一对「同一套数据、两套命名」的规范视图，并把真值写在旁边。
// 真值不是猜的：rename 表就是真值，align 不需要它，测试需要它。

const RENAME = {
  orders: 'tickets',
  menu: 'catalog',
  status_log: 'history',
};

const FIELD_RENAME = {
  id: 'key',
  username: 'owner',
  status: 'state',
  totalAmount: 'sum',
  pickupNo: 'no',
  createTime: 'at',
  items: 'lines',
  name: 'title',
  price: 'rate',
  type: 'event',
  orderId: 'ticketKey',
  from: 'prev',
  to: 'next',
  by: 'actor',
  dishName: 'label',
  count: 'qty',
  unitPrice: 'unitRate',
  subTotal: 'lineSum',
};

const ITEM_RENAME = { dishName: 'label', count: 'qty', unitPrice: 'unitRate', subTotal: 'lineSum' };

function refView() {
  const menu = [
    { id: 11, name: '拿铁', price: 28 },
    { id: 12, name: '美式', price: 22 },
    { id: 13, name: '卡布奇诺', price: 30 },
    { id: 14, name: '抹茶拿铁', price: 32 },
  ];
  const statuses = ['PENDING', 'MAKING', 'READY', 'PICKED'];
  const users = ['alice', 'bob', 'carol'];
  const orders = [];
  for (let i = 0; i < 6; i += 1) {
    const items = [
      { dishName: i % 2 === 0 ? '拿铁' : '美式', count: 1 + (i % 3), unitPrice: i % 2 === 0 ? 28 : 22, subTotal: 0 },
    ];
    if (i % 3 === 0) items.push({ dishName: '卡布奇诺', count: 2, unitPrice: 30, subTotal: 60 });
    for (const it of items) it.subTotal = it.unitPrice * it.count;
    const totalAmount = items.reduce((a, x) => a + x.subTotal, 0);
    orders.push({
      id: 1001 + i,
      username: users[i % users.length],
      status: statuses[i % statuses.length],
      totalAmount,
      pickupNo: 1001 + i + 100,
      createTime: 1767225600000 + i * 60000,
      items,
    });
  }
  const status_log = [];
  let logId = 1;
  for (const o of orders) {
    status_log.push({ id: logId, type: 'order.created', orderId: o.id, from: null, to: 'PENDING', by: o.username, at: o.createTime });
    logId += 1;
    if (o.status !== 'PENDING') {
      status_log.push({ id: logId, type: 'order.' + o.status.toLowerCase(), orderId: o.id, from: 'PENDING', to: o.status, by: 'barista', at: o.createTime + 30000 });
      logId += 1;
    }
  }
  return { orders, menu, status_log };
}

function renameObject(obj, table) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = table[k] || k;
    out[nk] = renameValue(v, table);
  }
  return out;
}

function renameValue(v, table) {
  if (Array.isArray(v)) return v.map((x) => renameValue(x, table));
  if (v && typeof v === 'object') return renameObject(v, table);
  return v;
}

function lowercaseKeys(obj) {
  if (Array.isArray(obj)) return obj.map(lowercaseKeys);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = lowercaseKeys(v);
    return out;
  }
  return obj;
}

function shuffle(rows, seed) {
  const out = rows.slice();
  let x = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

export function build() {
  const ref = refView();
  // 只改顶层集合名与字段名；items 内部的字段另有一套（嵌套数组，align 目前不递归进去）
  const renamedTop = {};
  for (const [k, rows] of Object.entries(ref)) {
    renamedTop[RENAME[k] || k] = rows.map((r) => renameObject(r, FIELD_RENAME));
  }
  // 难的那份：行被打乱、一个字段改名到毫无关系、一个字段丢掉、一个重复字段。
  const hard = {};
  for (const [k, rows] of Object.entries(renamedTop)) {
    hard[k] = shuffle(rows, 7).map((r) => {
      const out = Object.assign({}, r);
      if (k === 'tickets') {
        if (out.sum !== undefined) { out.x9 = out.sum; delete out.sum; }
        delete out.no;
        out.maker = out.owner;
      }
      if (k === 'history' && out.event !== undefined) { out.category = out.event; delete out.event; }
      return out;
    });
  }
  return { ref, renamed: renamedTop, hard, rename: { ...RENAME }, field_rename: { ...FIELD_RENAME }, item_rename: { ...ITEM_RENAME } };
}

if (process.argv[1] && process.argv[1].endsWith('make.mjs')) {
  const { ref, renamed, hard, rename, field_rename } = build();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  fs.writeFileSync(path.join(dir, 'ref-view.json'), JSON.stringify(ref, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'renamed-view.json'), JSON.stringify(renamed, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'hard-view.json'), JSON.stringify(hard, null, 2) + '\n');
  const hardFields = Object.assign({}, field_rename, { type: 'category' });
  delete hardFields.pickupNo;
  hardFields.totalAmount = null; // 被改成 x9 了，名字毫无关系，机器应该说不清
  fs.writeFileSync(path.join(dir, 'truth.json'), JSON.stringify({ collections: rename, fields: field_rename, hard_fields: hardFields }, null, 2) + '\n');
  console.log('wrote fixtures');
}

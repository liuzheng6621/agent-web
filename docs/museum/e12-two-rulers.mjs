/**
 * 展品 12：同一笔账，两把尺子。
 *
 * relation 的五个算子里，sum_equals 用绝对容差 1e-9 判「和等于总额」，
 * sum_by_equals 用精确相等（l !== r）判「借贷平衡」。两把尺子量同一类东西，
 * 结论却可以相反。这一笔账就是证据：
 *
 *     debit: 0.1 + 0.2        credit: 0.3
 *
 * 0.1 + 0.2 与 0.3 差 5.6e-17 —— 那是 float64 的错，不是账的错。
 * sum_equals 说这账是平的，sum_by_equals 说它 relation_violated。
 * 同一个判决器、同一份状态、同一笔账，两个算子给出相反的判决，
 * 总有一个在撒谎。
 *
 * 而大额账上两把尺子一起错：7 笔 (1e9/7) 加起来与 1e9 差 2.4e-7，
 * float64 在这个量级的最小间隔（ulp ≈ 1.2e-7）本来就比 1e-9 大。
 * 固定绝对容差把「算得对的大额账」判成 violation —— 假红跟假绿一样毁判决：
 * 前者让人去查一笔没坏的账，查三次之后没人再信这个断言。
 *
 * 修法不是把容差调大，是**只留一把尺**：close(x, y)，容差随量级走
 * （相对 1e-9，绝对下限 1e-9），三个数值算子共用。
 *
 * 这是失败案例库里第一件「假红」：前面十一件都是「错的被放过」，
 * 这一件是「对的被定罪」。方向相反，毁掉的是同一个东西 —— 判决的可信度。
 */

export const meta = {
  id: 'e12-two-rulers',
  title: '同一笔账，两把尺子',
  symptom: 'sum_by_equals 用精确相等判借贷平衡：0.1+0.2 的合法账被记成 relation_violated',
  mechanism: '同一文件里 sum_equals 用 1e-9、sum_by_equals 用 ===；现在统一为随量级走的 close()（src/assert/relation.mjs 只有一把尺）',
  naive: 'false',
  caught: 'true',
  caughtCode: 'ok',
};

/** 旧行为：sum_by_equals 的精确相等。账差 5.6e-17 也算不平。 */
function legacySumByEquals(l, r) {
  return l === r;
}

const FLOATY = { final: { transactions: [{ entries: [
  { direction: 'debit', amount: 0.1 }, { direction: 'debit', amount: 0.2 },
  { direction: 'credit', amount: 0.3 },
] }] } };

const SPEC = {
  selector: { collection: 'transactions' },
  op: 'sum_by_equals', leaf: 'entries', field: 'amount', group_field: 'direction', left: 'debit', right: 'credit',
};

const BIG_LEGIT = { final: { transactions: [{ entries:
  Array.from({ length: 7 }, () => ({ direction: 'debit', amount: 1e9 / 7 }))
    .concat([{ direction: 'credit', amount: 1e9 }])
}] } };

const BIG_OFF = { final: { transactions: [{ entries: [
  { direction: 'debit', amount: 1e9 }, { direction: 'debit', amount: 1e9 },
  { direction: 'credit', amount: 2e9 - 100 },
] }] } };

export async function run() {
  // 第一幕：旧行为对 0.1+0.2 的合法账判假红。
  const e = FLOATY.final.transactions[0].entries;
  const l = e.filter((x) => x.direction === 'debit').reduce((a, b) => a + b.amount, 0);
  const r = e.filter((x) => x.direction === 'credit').reduce((a, b) => a + b.amount, 0);
  if (legacySumByEquals(l, r) !== false) {
    throw new Error('复刻的旧行为不成立：精确相等本来应该把这笔账判成不平');
  }

  // 第二幕：现在的求值器必须判 true。
  const { relation } = await import('../../src/assert/relation.mjs');
  const now = relation(SPEC, FLOATY);
  if (now.status !== 'true') {
    throw new Error('0.1+0.2 的账又被判假红了 —— 两把尺子回来了：' + now.message);
  }

  // 第三幕（反向验证）：大额合法账也必须 true，真不平的账必须照旧 false。
  // 少了这一道，把 close 改成「永远相等」的假修法也能骗过第二幕。
  const bigLegit = relation(SPEC, BIG_LEGIT);
  if (bigLegit.status !== 'true') {
    throw new Error('大额合法账被容差误伤：' + bigLegit.message);
  }
  const bigOff = relation(SPEC, BIG_OFF);
  if (bigOff.status !== 'false' || bigOff.code !== 'relation_violated') {
    throw new Error('差 100 元的真不平没被抓住，容差被放宽过头了：' + bigOff.message);
  }

  return {
    naive: {
      status: 'false',
      reason_code: 'relation_violated',
      detail: '精确相等：0.1+0.2 与 0.3 差 5.6e-17，合法账被定罪',
    },
    caught: {
      status: 'true',
      reason_code: 'ok',
      detail: '一把尺（close，相对 1e-9）：小数不假红、大额不误伤、真不平照旧红',
    },
  };
}

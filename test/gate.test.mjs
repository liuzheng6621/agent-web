import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateReport, formatGate, GATE_VERSION } from '../src/gate.mjs';

// 合成数据：四行数据源的形状来自 capabilities / certify / verify / compare 的真实输出。
const goodCoverage = { rate: { covered: 7, declared: 9, value: 7 / 9 } };
const goodCertify = { summary: { caught: 48, applicable: 50, caughtRate: 48 / 50 } };
const goodVerdicts = [
  { status: 'pass' }, { status: 'fail' }, { status: 'unknown' }, { status: 'pass' },
];
// comparable 是必需字段（v0.78.2）：缺了不再回退成 total，而是记红线。
const goodCompare = { agree: 3, total: 4, comparable: 3, left: 'a', right: 'b' };

test('gate-1：四行齐全时 sound=true，rows 四键都在', () => {
  const r = gateReport({ coverage: goodCoverage, certify: goodCertify, verdicts: goodVerdicts, compare: goodCompare });
  assert.equal(r.version, GATE_VERSION);
  assert.equal(r.sound, true);
  assert.deepEqual(r.missing, []);
  for (const k of ['coverage', 'resistance', 'independent', 'unknown']) {
    assert.ok(r.rows[k], `缺 ${k}`);
    assert.ok(r.rows[k].value >= 0 && r.rows[k].value <= 1);
  }
  assert.equal(r.rows.coverage.covered, 7);
  assert.equal(r.rows.coverage.declared, 9);
  assert.equal(r.rows.resistance.caught, 48);
  assert.equal(r.rows.independent.supported, 3);
  assert.equal(r.rows.unknown.count, 1);
  assert.equal(r.rows.unknown.total, 4);
});

test('没跑 certify → resistance 进 missing；没跑 compare → independent 进 missing', () => {
  const r = gateReport({ coverage: goodCoverage, certify: null, verdicts: goodVerdicts, compare: null });
  assert.equal(r.sound, false);
  assert.deepEqual(r.missing, ['resistance', 'independent']);
});

test('判决为零 → unknown 缺行；coverage 分母为零 → coverage 缺行', () => {
  const r = gateReport({ coverage: { rate: { covered: 0, declared: 0, value: null } }, certify: goodCertify, verdicts: [], compare: goodCompare });
  assert.deepEqual(r.missing.sort(), ['coverage', 'unknown']);
});

test('certify applicable=0（全不适用）→ resistance 缺行，不是 0/0', () => {
  const r = gateReport({ coverage: goodCoverage, certify: { summary: { caught: 0, applicable: 0, caughtRate: null } }, verdicts: goodVerdicts, compare: goodCompare });
  assert.deepEqual(r.missing, ['resistance']);
});

test('formatGate：全部 m/n 形式，无分母百分比与禁语都不得出现', () => {
  const r = gateReport({ coverage: goodCoverage, certify: goodCertify, verdicts: goodVerdicts, compare: goodCompare, policy: { ok: true, total: 12, mismatch: 0 } });
  const t = formatGate(r);
  for (const banned of ['score', 'grade', 'rank', '100% 正确']) {
    assert.ok(!t.toLowerCase().includes(banned), `禁语漏出：${banned}`);
  }
  assert.ok(t.includes('7/9'), '覆盖率必须有分母');
  assert.ok(t.includes('48/50'), '抗变异率必须有分母');
  assert.ok(t.includes('3/4'), '独立证据必须有分母');
  assert.ok(t.includes('1/4'), 'unknown 占比必须有分母');
  assert.ok(t.includes('policy 佐证 12/12'));
  assert.ok(t.includes('unknown 留在分母'));
});

test('formatGate：缺行时列出缺行名并说 exit 1', () => {
  const r = gateReport({ coverage: goodCoverage, certify: null, verdicts: goodVerdicts, compare: null });
  const t = formatGate(r);
  assert.ok(t.includes('resistance'));
  assert.ok(t.includes('independent'));
  assert.ok(t.includes('exit 1'));
});

// 真适配器条件端到端：Windows + coffee-sql env 齐才跑（与 test/sql-shell-dispose.test.mjs 同门槛）。
// 单案例全量 gate（certify 默认开）：四行齐全 → rc=0；happy-path 两通道判决不一致（已知域语义差异）
// 只压低第三行的值，不红——口径门禁不管质量。
test('真适配器 e2e：gate 单案例四行齐 → rc=0', { skip: process.platform !== 'win32' || !process.env.TAIXIANGLIAN_SQL_DB_URL || !process.env.TAIXIANGLIAN_BASE_URL ? '需要 Windows + TAIXIANGLIAN_* env + 后端在跑' : false }, async () => {
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let out = '';
  let status = null;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'agent-web.mjs'), 'gate', path.join(ROOT, 'cases', 'coffee', 'happy-path.json'), '--adapter=memory', '--compare=taixianglian-sql', '--no-policy'], { encoding: 'utf8', timeout: 120000 });
    status = 0;
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    status = e.status;
  }
  assert.equal(status, 0, `单案例四行应齐全退 0：${out.slice(0, 400)}`);
  assert.ok(out.includes('独立证据判决率'), '第三行必须出现');
  assert.ok(out.includes('unknown 占比'), '第四行必须出现');
  assert.ok(out.includes('memory vs taixianglian-sql'), '对照双方必须写明');
  assert.ok(out.includes('四行齐全'), '放行句必须出现');
});

// ---- 可比证据闸（v0.76.0，外部测评发现 1）----

test('compare 全列 unknown（comparable=0）→ independent 视同缺行', () => {
  const r = gateReport({
    coverage: goodCoverage,
    certify: goodCertify,
    verdicts: goodVerdicts,
    compare: { agree: 1, total: 13, comparable: 0, left: 'memory', right: 'taixianglian' },
  });
  assert.equal(r.sound, false);
  assert.ok(r.missing.includes('independent'), `missing=${JSON.stringify(r.missing)}`);
});

test('--min-comparable 下限被击穿 → violations 非空、sound=false', () => {
  const r = gateReport({
    coverage: goodCoverage,
    certify: goodCertify,
    verdicts: goodVerdicts,
    compare: { agree: 1, total: 13, comparable: 1, left: 'memory', right: 'taixianglian' },
    minComparable: 8,
  });
  assert.equal(r.sound, false);
  assert.equal(r.missing.length, 0);
  assert.equal(r.violations.length, 1);
  assert.ok(r.violations[0].includes('1/13'), r.violations[0]);
});

test('可比 < total 时行里显式报 unknown 对数（不冒充一致）', () => {
  const r = gateReport({
    coverage: goodCoverage,
    certify: goodCertify,
    verdicts: goodVerdicts,
    compare: { agree: 11, total: 13, comparable: 11, left: 'memory', right: 'taixianglian' },
  });
  assert.equal(r.sound, true);
  assert.equal(r.rows.independent.comparable, 11);
  const t = formatGate(r);
  assert.ok(t.includes('可比 11/13'), t);
  assert.ok(t.includes('2 对判决里含 unknown'), t);
});

// ---- 默认下限与旧格式（v0.78.2，v0.78.0 二次测评残留 1、2）----

test('默认下限 = 案例数的一半：13 条里只有 1 对可比 → 红线（不再放行）', () => {
  const r = gateReport({
    coverage: goodCoverage,
    certify: goodCertify,
    verdicts: goodVerdicts,
    compare: { agree: 1, total: 13, comparable: 1, left: 'memory', right: 'taixianglian' },
  });
  assert.equal(r.sound, false, '默认必须拦下「几乎没证据」');
  assert.equal(r.missing.length, 0, '有可比判决就不是缺行');
  assert.equal(r.violations.length, 1);
  assert.ok(r.violations[0].includes('1/13'), r.violations[0]);
  assert.ok(r.violations[0].includes('7'), `默认下限应是 ceil(13/2)=7：${r.violations[0]}`);
  assert.equal(r.rows.independent.floor, 7);
});

test('--min-comparable=0 是显式关掉：同样 1/13 可比也放行', () => {
  const r = gateReport({
    coverage: goodCoverage,
    certify: goodCertify,
    verdicts: goodVerdicts,
    compare: { agree: 1, total: 13, comparable: 1, left: 'memory', right: 'taixianglian' },
    minComparable: 0,
  });
  assert.equal(r.sound, true);
  assert.equal(r.violations.length, 0);
});

test('compare 缺 comparable 字段（旧格式）→ 红线 + 缺行，不回退成 total', () => {
  const r = gateReport({
    coverage: goodCoverage,
    certify: goodCertify,
    verdicts: goodVerdicts,
    compare: { agree: 3, total: 4, left: 'a', right: 'b' },
  });
  assert.equal(r.sound, false);
  assert.ok(r.missing.includes('independent'));
  assert.equal(r.violations.length, 1);
  assert.ok(r.violations[0].includes('comparable'), r.violations[0]);
  assert.ok(r.violations[0].includes('旧格式'), r.violations[0]);
});

test('CI 用的 ledger gate 真能通过；下限超过 4 条时必须点名「低于下限」', async () => {
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const base = [path.join(ROOT, 'bin', 'agent-web.mjs'), 'gate', 'cases/ledger',
    '--adapter=ledger-a', '--compare=ledger-b'];
  const run = (floor) => {
    try {
      const stdout = execFileSync(process.execPath, [...base, `--min-comparable=${floor}`], {
        encoding: 'utf8', cwd: ROOT, timeout: 120000,
      });
      return { status: 0, output: stdout };
    } catch (e) {
      return { status: e.status, output: String(e.stdout || '') + String(e.stderr || '') };
    }
  };
  const pass = run(4);
  assert.equal(pass.status, 0, `ledger 的 4/4 可比证据应通过：${pass.output.slice(0, 500)}`);
  assert.ok(pass.output.includes('可比 4/4'), '通过时必须写明可比分母');
  const fail = run(5);
  assert.equal(fail.status, 1, `下限 5 超过 4 条案例时必须 exit 1：${fail.output.slice(0, 500)}`);
  assert.ok(fail.output.includes('低于下限 5'), `失败时必须点名低于下限 5：${fail.output.slice(0, 500)}`);
});

// taixianglian-sql 适配器的 Shell 生命周期守卫。
//
// 事故：certify 一次跑对每个 run 都造一次性适配器，close(runId) 只删账不收
// Shell，全靠 30s 空闲自退 —— 峰值堆出 33 个 java 进程，把真实后端压到
// fetch failed（write-landed 基准跑全体 unknown → 断言全 unarmed）。
// 修法：close(runId) 在 runs 清空时立即 shell.stop()。
// 本守卫在真实后端 + 真实 H2 上数进程：observe 起一个，close 后必须消失。
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const DB_URL = process.env.TAIXIANGLIAN_SQL_DB_URL || '';
const JAVA = process.env.TAIXIANGLIAN_SQL_JAVA || '';
const H2_JAR = process.env.TAIXIANGLIAN_SQL_H2_JAR || '';
const BASE_URL = process.env.TAIXIANGLIAN_BASE_URL || '';
const envOk = Boolean(DB_URL && JAVA && H2_JAR && BASE_URL);
const isWin = process.platform === 'win32';

function javaCount() {
  const out = execSync('tasklist /FI "IMAGENAME eq java.exe" /FO CSV /NH', { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.trim().startsWith('"java.exe"')).length;
}

test('taixianglian-sql close 立即收 Shell（不等 30s 空闲自退）', {
  skip: !isWin ? '进程计数仅 Windows（tasklist）'
    : !envOk ? '缺 TAIXIANGLIAN_SQL_* / TAIXIANGLIAN_BASE_URL env（source .env-coffee-sql）'
    : false,
}, async (t) => {
  const { createTaixianglianSqlAdapter } = await import('../src/adapter/taixianglian-sql.mjs');
  const adapter = createTaixianglianSqlAdapter({});
  const base = javaCount();
  let runId = null;
  let resetOk = false;
  try {
    const r = await adapter.reset();
    runId = r.runId;
    resetOk = true;
  } catch {
    t.skip('后端未启动，跳过（起后端：bash s0-coffee-harness.sh start）');
    return;
  }
  assert.ok(resetOk);
  await adapter.observe(runId); // 触发 Shell 启动
  const during = javaCount();
  assert.ok(during >= base + 1, `observe 后应有 Shell 进程（base=${base}, during=${during}）`);
  await adapter.close(runId);
  let after = -1;
  for (let i = 0; i < 16; i++) {
    await new Promise((r2) => setTimeout(r2, 500));
    after = javaCount();
    if (after <= base) break;
  }
  assert.ok(after <= base, `close 后 Shell 应退出（base=${base}, after=${after}）`);
  await adapter.close(runId); // 幂等：第二次 close 不许炸
  try { adapter.dispose(); } catch { /* 幂等 */ }
});

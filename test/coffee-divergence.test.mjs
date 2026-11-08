import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 受控分歧守卫（v0.76.0，外部测评发现 2）：
// coffee 域两通道（memory vs taixianglian 真实后端）存在两条**已登记**的语义分歧
// （docs/domains/coffee.md「两通道已知不一致」：memory 适配器下单 push order.created，
// 后端设计上下单不落 t_order_status_log）。这两条分歧不红；出现任何第三条分歧 = 红。
// 后端不在跑时 skip（CI 无 Spring 后端，物理跑不了 compare cases/coffee——这不是回避，
// 是环境边界；守卫的价值在本机每次起后端回归时兑现）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTROLLED = new Set(['coffee/happy-path', 'coffee/linkage-events']);
const BASE = process.env.TAIXIANGLIAN_BASE_URL || 'http://127.0.0.1:8099';
const backendUp = async () => {
  const base = BASE;
  try {
    const res = await fetch(base + '/menu', { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
};

test('coffee 双通道分歧 ⊆ 受控清单', { skip: process.platform !== 'win32' || !(await backendUp()) ? '需要 Windows + taixianglian 后端在跑（TAIXIANGLIAN_BASE_URL 或 127.0.0.1:8099）' : false }, () => {
  let out = '';
  let status = null;
  try {
    out = execFileSync(process.execPath, [join(ROOT, 'bin', 'agent-web.mjs'), 'compare', join(ROOT, 'cases', 'coffee'), '--adapters=memory,taixianglian'], { encoding: 'utf8', cwd: ROOT, timeout: 300000, env: { ...process.env, TAIXIANGLIAN_BASE_URL: BASE } });
    status = 0;
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    status = e.status; // compare 在有分歧时 exit 1，正常
  }
  const diverged = [...out.matchAll(/^(coffee\/[\w-]+)\s+\S+\s+\S+\s+✗/gm)].map((m) => m[1]);
  assert.ok(diverged.length > 0 ? status === 1 : status === 0, `compare 退出码 ${status} 与分歧数不符：${out.slice(0, 300)}`);
  const uncontrolled = diverged.filter((d) => !CONTROLLED.has(d));
  assert.deepEqual(uncontrolled, [], `出现不受控分歧（已知受控分歧：${[...CONTROLLED].join('、')}）：${uncontrolled.join('、')}`);
});

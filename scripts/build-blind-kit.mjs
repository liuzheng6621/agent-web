#!/usr/bin/env node
/**
 * build-blind-kit —— 把本仓库打成一份「盲测包」。
 *
 * 盲测包 = 可独立运行的最小 agent-web + 全部零依赖域的案例（不含 expected.json、
 * 不含变异体、不含任何判决）。拿到包的人在完全独立的机器上原样跑 verify，
 * 把 results 回投；我们用 blind/reference.json 对账。
 *
 * 判决由「案例 + 断言 + 适配器」唯一确定，所以理想结果是与我们逐案例一致；
 * 任何分歧都是发现（他的环境、我们的 bug、或他改了案例——MANIFEST 会拆穿）。
 *
 * 用法：
 *   node scripts/build-blind-kit.mjs                  # 产 build/agent-web-blind-kit-vX.Y.Z/
 *   node scripts/build-blind-kit.mjs --with-reference # 另产 blind/reference.json（本地跑四域+realworld）
 */
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
const OUT = join(ROOT, 'build', `agent-web-blind-kit-v${VERSION}`);

// 零依赖域：适配器与案例全部自带，不需要任何外部系统。
const DOMAINS = ['coffee', 'ledger', 'lexicon', 'cron', 'realworld'];
// 每域默认适配器（BLIND.md 的命令与 reference 都按它跑）。
const DEFAULT_ADAPTERS = { coffee: 'memory', ledger: 'ledger-a', lexicon: 'lexicon-a', cron: 'cron-a', realworld: 'realworld' };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1) 运行体：bin + src + examples + 迷你 package.json。
cpSync(join(ROOT, 'bin'), join(OUT, 'bin'), { recursive: true });
cpSync(join(ROOT, 'src'), join(OUT, 'src'), { recursive: true });
cpSync(join(ROOT, 'examples'), join(OUT, 'examples'), { recursive: true });
cpSync(join(ROOT, 'knowledge'), join(OUT, 'knowledge'), { recursive: true });
cpSync(join(ROOT, 'docs', 'mutants'), join(OUT, 'docs', 'mutants'), { recursive: true }); // src/mutate.mjs 静态 import 变异体登记表；变异体本就公开（主仓可 clone），隔离的是 expected.json 与 reference.json // recall 事故档案是惰性 import，缺了 verify 会炸
// examples 里也有教学用 expected.json（adapter-template、animal-tracking），
// 口号是「包里没有答案」，一并剔除，避免对账歧义。
function stripExpected(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) stripExpected(p);
    else if (f === 'expected.json') rmSync(p);
  }
}
stripExpected(join(OUT, 'examples'));

writeFileSync(
  join(OUT, 'package.json'),
  JSON.stringify(
    { name: 'agent-web-blind-kit', version: VERSION, private: true, type: 'module', engines: { node: '>=20' } },
    null,
    2,
  ) + '\n',
);

// 2) cases-blind：五域案例原样拷贝，剔除 expected.json 与一切判决性文件。
for (const domain of DOMAINS) {
  const from = join(ROOT, 'cases', domain);
  const to = join(OUT, 'cases-blind', domain);
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    if (f === 'expected.json') continue; // 答案不进盲测包
    const p = join(from, f);
    if (statSync(p).isFile()) cpSync(p, join(to, f));
  }
}

// 3) BLIND.md：盲测说明（命令与默认适配器都由 DOMAINS 生成，防漂移）。
function blindMd() {
  const lines = [];
  lines.push(`# agent-web 盲测包 v${VERSION}`);
  lines.push('');
  lines.push('你手里这套案例**已经被判决过一次**。你的任务不是做题，是复现：');
  lines.push('在**你的机器**上原样跑完，把判决原样回投。你的数字会成为');
  lines.push('主仓 README「第三方独立复现」台账的第一行。');
  lines.push('');
  lines.push('## 规则（三条）');
  lines.push('');
  lines.push('1. **不要改 `cases-blind/` 里的任何文件**。案例 + 断言 = 判决，改断言等于改答案；');
  lines.push('   回投会附带文件清单，对账时逐文件比对哈希。');
  lines.push('2. **unknown 不是错**。判不出就回投 unknown，如实即可——它留在分母里，');
  lines.push('   不会被算成通过或失败。');
  lines.push('3. **不要对着答案跑**。包里没有答案，这就是盲测。');
  lines.push('');
  lines.push('## 怎么跑（Node >= 20，无任何安装步骤）');
  lines.push('');
  for (const d of DOMAINS) {
    lines.push(`\`\`\`bash`);
    lines.push(`node bin/agent-web.mjs verify cases-blind/${d} --adapter=${DEFAULT_ADAPTERS[d]} --out=results/${d}.jsonl`);
    lines.push('```');
    if (d === 'realworld') {
      lines.push('');
      lines.push('realworld 域要先在**另一个终端**起仿真服务（零依赖 Node，Ctrl-C 结束）：');
      lines.push('');
      lines.push('```bash');
      lines.push('node examples/realworld/fake-server.mjs');
      lines.push('```');
    }
  }
  lines.push('');
  lines.push('跑完 `results/` 下每域一个 jsonl，每行一个案例的完整判决。');
  lines.push('');
  lines.push('## 回投什么');
  lines.push('');
  lines.push('1. 先确认你**没有改过**案例：');
  lines.push('');
  lines.push('```bash');
  lines.push(`python -c "import hashlib,glob; [print(hashlib.sha256(open(f,'rb').read()).hexdigest(), f.replace(chr(92),'/')) for f in sorted(glob.glob('cases-blind/**/*.*', recursive=True))]" > results/MANIFEST.check`);
  lines.push('```');
  lines.push('');
  lines.push('   realworld 注意：fake-server **有内存态**——同一个实例跑两轮 verify，第二轮会因脏状态整域 fail。每次跑 realworld 前重起一个新实例（Ctrl+C 再跑一遍启动命令即可）。');
  lines.push('');
  lines.push('2. 把 `results/` 打包，开一个 GitHub issue 附上：');
  lines.push('   <https://github.com/liuzheng6621/agent-web/issues>，标题 `[blind-result] v${VERSION}`。');
  lines.push('   不用写结论，对账在我们这端做；有分歧我们会回到你这里对环境。');
  lines.push('');
  lines.push('## 判决怎么算（透明）');
  lines.push('');
  lines.push('- `pass` / `fail`：断言当场给出，机器可查。');
  lines.push('- `unknown`：证据不足（环境不可达、能力缺失等），带 `reason_code`，留在分母。');
  lines.push('- 对账口径：逐案例比对你的判决与我们的判决（`blind/reference.json`，随盲测结果一起公开）。');
  return lines.join('\n') + '\n';
}
writeFileSync(join(OUT, 'BLIND.md'), blindMd());

// 4) MANIFEST.sha256：cases-blind 全部文件 + BLIND.md（哈希按包内相对路径）。
function walk(dir, base) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const rel = base ? base + '/' + f : f;
    if (statSync(p).isDirectory()) out.push(...walk(p, rel));
    else out.push(rel);
  }
  return out;
}
const manifestFiles = walk(join(OUT, 'cases-blind'), 'cases-blind').concat(['BLIND.md']);
const manifest = manifestFiles
  .sort()
  .map((rel) => createHash('sha256').update(readFileSync(join(OUT, rel))).digest('hex') + '  ' + rel)
  .join('\n');
writeFileSync(join(OUT, 'MANIFEST.sha256'), manifest + '\n');

console.log(`盲测包就绪: ${OUT}`);
console.log(`  案例 ${manifestFiles.length - 1} 个文件（五域，无 expected.json）`);
console.log(`  说明 BLIND.md + 清单 MANIFEST.sha256`);

// 5) --with-reference：就在打包产物里原样跑一遍（包括 realworld 仿真服务），
//    把 {case_id → verdict} 存进 blind/reference.json。这个文件**不进包**，
//    它是答案，是回投对账的基准。
if (process.argv.includes('--with-reference')) {
  const { spawnSync, spawn } = await import('node:child_process');
  const tmp = join(OUT, '.reference-run');
  mkdirSync(tmp, { recursive: true });
  const cases = {};

  function runVerify(domain, adapter) {
    const outFile = join(tmp, `${domain}.jsonl`);
    const r = spawnSync(process.execPath, ['bin/agent-web.mjs', 'verify', `cases-blind/${domain}`, `--adapter=${adapter}`, `--out=${outFile}`], {
      cwd: OUT, encoding: 'utf8', timeout: 120000,
    });
    if (r.status !== 0 && !existsSync(outFile)) {
      throw new Error(`verify ${domain} 失败 (exit ${r.status}): ${(r.stderr || '').slice(-400)}`);
    }
    for (const line of readFileSync(outFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      // jsonl 的 case_id 已含域前缀（coffee/happy-path），直接做 key。
      cases[row.case_id] = { verdict: row.status, reason_code: row.reason_code ?? null };
    }
  }

  for (const d of ['coffee', 'ledger', 'lexicon', 'cron']) runVerify(d, DEFAULT_ADAPTERS[d]);

  // realworld：起仿真服务 → 探活 → verify → 杀进程树。
  // 先确认 8299 空闲——打到别人的旧实例上，判决会被旧状态污染且毫无察觉。
  const busy = spawnSync(process.execPath, ['-e', `require('node:net').connect({host:'127.0.0.1',port:8299},function(){console.log('busy');process.exit(0)}).on('error',()=>{console.log('free');process.exit(0)})`], { encoding: 'utf8' });
  if (busy.stdout?.trim() === 'busy') throw new Error('端口 8299 已被占用（可能有旧的 fake-server 在跑）。先结束它再构建，否则判决会被污染。');
  const server = spawn(process.execPath, ['examples/realworld/fake-server.mjs'], { cwd: OUT, stdio: 'ignore' });
  try {
    const port = Number(process.env.REALWORLD_PORT || 8299);
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 250));
      // node -e 的 promise 结果必须显式 console.log，否则进程静默退出、stdout 为空。
      const probe = spawnSync(process.execPath, ['-e', `fetch('http://127.0.0.1:${port}/').then(()=>console.log('up')).catch(()=>console.log('down'))`], { encoding: 'utf8' });
      up = probe.stdout?.trim() === 'up';
    }
    if (!up) throw new Error('fake-server 未就绪');
    runVerify('realworld', DEFAULT_ADAPTERS.realworld);
  } finally {
    try { execFileSync('taskkill', ['/PID', String(server.pid), '/F', '/T'], { stdio: 'ignore' }); } catch {}
  }
  rmSync(tmp, { recursive: true, force: true });

  mkdirSync(join(ROOT, 'blind'), { recursive: true });
  const ref = { version: VERSION, generated_at: new Date().toISOString(), cases };
  writeFileSync(join(ROOT, 'blind', 'reference.json'), JSON.stringify(ref, null, 2) + '\n');
  const n = Object.keys(cases).length;
  const pass = Object.values(cases).filter((c) => c.verdict === 'pass').length;
  const fail = Object.values(cases).filter((c) => c.verdict === 'fail').length;
  const unknown = n - pass - fail;
  console.log(`reference.json: ${n} 案例（pass ${pass} / fail ${fail} / unknown ${unknown}）→ blind/reference.json`);
}

// 6) 打 zip（shutil 走系统 python，零 npm 依赖）。
try {
  execFileSync('python', ['-c', `import shutil; shutil.make_archive(r'${OUT}', 'zip', r'${OUT}')`], { stdio: 'ignore' });
  console.log(`zip: ${OUT}.zip`);
} catch {
  console.log('（系统无 python，跳过 zip；目录本身可用）');
}

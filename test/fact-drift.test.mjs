import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// 磁盘上的 .test.mjs 必须全部登记进 package.json 的 test 脚本——
// 差集就是 CI 每轮静默少跑的用例（v0.75.0 曾差 3 个文件 14 条用例）。
test('test 名单覆盖磁盘上的全部 .test.mjs', () => {
  const pkg = JSON.parse(read('package.json'));
  const listed = new Set(
    pkg.scripts.test.split(/\s+/).map((x) => x.split('/').pop()).filter((x) => x.endsWith('.test.mjs'))
  );
  const disk = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs'));
  const missing = disk.filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], `未登记进 npm test 的测试文件: ${missing.join(', ')}`);
});

// selftest 条数写进 README 的两处——以 selftest --json 的 total 为准。
function selftestTotal() {
  const out = execFileSync(process.execPath, [join(ROOT, 'bin', 'agent-web.mjs'), 'selftest', '--json'], {
    encoding: 'utf8', cwd: ROOT,
  });
  const d = JSON.parse(out);
  return d.summary.total;
}

test('README 两处 selftest 条数与 selftest --json 一致', () => {
  const total = selftestTotal();
  assert.ok(total >= 12, `selftest 条数异常: ${total}`);
  for (const [file, re] of [
    ['README.md', new RegExp(String.raw`\`selftest\` (\d+) 条标签`)],
    ['README.en.md', new RegExp(String.raw`\`selftest\` labels (\d+) cases`)],
  ]) {
    const m = read(file).match(re);
    assert.ok(m, `${file} 里找不到 selftest 条数句`);
    assert.equal(Number(m[1]), total, `${file} 的 selftest 条数 ${m[1]} != 实际 ${total}`);
  }
});

// 边界节 L5 的口径必须与 LIMITS 总表 L5 同源——v0.75.0 时 zh 是 67/43/45、en 是 63/39/41，
// 而 LIMITS 早已是 72/50/48。数字只能有一个出处。
function limitsL5() {
  const s = read('docs/LIMITS.md');
  const m = s.match(/当前口径：(\d+) 个变异体，(\d+) 条案例，适用 (\d+)，抓到 (\d+)/);
  assert.ok(m, 'LIMITS L5 口径行格式变了');
  return { total: Number(m[1]), cases: Number(m[2]), applicable: Number(m[3]), caught: Number(m[4]) };
}

test('README 边界节 L5 口径与 LIMITS L5 一致（zh/en）', () => {
  const l5 = limitsL5();
  const zh = read('README.md').match(/变异体覆盖不完整（L5）。.*?全仓口径 (\d+) 个变异体，适用 (\d+) 抓到 (\d+)/);
  assert.ok(zh, 'README.md L5 条目格式变了');
  assert.equal(Number(zh[1]), l5.total, 'zh L5 变异体总数漂移');
  assert.equal(Number(zh[2]), l5.applicable, 'zh L5 适用数漂移');
  assert.equal(Number(zh[3]), l5.caught, 'zh L5 抓到数漂移');
  const en = read('README.en.md').match(/Mutant coverage is incomplete \(L5\)\..*?repo-wide: (\d+) mutants, (\d+) of (\d+) applicable caught/);
  assert.ok(en, 'README.en.md L5 条目格式变了');
  assert.equal(Number(en[1]), l5.total, 'en L5 变异体总数漂移');
  assert.equal(Number(en[2]), l5.caught, 'en L5 抓到数漂移');
  assert.equal(Number(en[3]), l5.applicable, 'en L5 适用数漂移');
});

test('docs/README.md 的变异体数与 LIMITS L5 一致', () => {
  const l5 = limitsL5();
  const m = read('docs/README.md').match(/\[docs\/mutants\/\]\(mutants\/README\.md\) \| (\d+) 个变异体目录/);
  assert.ok(m, 'docs/README.md 变异体行格式变了');
  assert.equal(Number(m[1]), l5.total, 'docs/README.md 变异体数漂移');
});

// ---- L13：npm 包状态必须与 registry 真相对齐（v0.78.3）----

const PUBLICATION_MARKERS = [
  ['README.md', ['npm 包尚未发布', '发布前会 404']],
  ['README.en.md', ['The npm package is not published yet', '404 until published']],
  ['site/index.html', ['尚未发布', 'npx agent-case selftest</code> 现在会 404']],
];

function publicationTexts() {
  return PUBLICATION_MARKERS.map(([file]) => [file, read(file)]);
}

test('L13：本地声明必须与台账状态一致，不许在 open 时假装能跑', () => {
  const limits = read('docs/LIMITS.md');
  const start = limits.indexOf('## L13 ');
  if (start < 0) return;
  const next = limits.indexOf('\n## ', start + 4);
  const block = limits.slice(start, next > 0 ? next : limits.length);
  const open = /`status: open`/.test(block);
  for (const [name, text] of publicationTexts()) {
    const marks = PUBLICATION_MARKERS.find(([file]) => file === name)[1];
    for (const mark of marks) {
      assert.equal(text.includes(mark), open,
        open ? `${name} 少了「${mark}」——L13 还是 open，不许把 npx 那行当真`
          : `${name} 仍含「${mark}」——L13 已关闭，过期声明必须删掉`);
    }
  }
  for (const [name, text] of publicationTexts().slice(0, 2)) {
    assert.ok(!text.includes('连仓库都不用 clone'), `${name} 仍在说不用 clone`);
    assert.ok(!text.includes('One line, no clone'), `${name} still says "no clone"`);
  }
});

const registryProbe = (() => {
  const args = ['view', 'agent-case', 'version', '--registry=https://registry.npmjs.org'];
  // npm.cmd 在 Windows 上不能由 spawnSync 直接 exec（EINVAL）。
  // 优先复用正在运行 npm test 的 npm-cli.js；直接 node 跑测试时走已安装的 npm-cli.js。
  const npmCli = process.env.npm_execpath;
  const candidates = [
    npmCli,
    process.platform === 'win32' && join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  let r;
  for (const cli of candidates) {
    r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20000 });
    if (r.status === 0 || /E404|404 Not Found|is not in this registry|Not found/i.test(`${r.stdout || ''}\n${r.stderr || ''}`)) break;
  }
  if (!r || r.error) {
    r = spawnSync('npm', args, { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32' });
  }
  const output = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  if (r.status === 0 && output) return { kind: 'published', version: output.split(/\s+/).pop() };
  if (/E404|404 Not Found|is not in this registry|Not found/i.test(output)) return { kind: 'absent' };
  return { kind: 'unreachable', detail: output || r.error?.message || `npm view exit ${r.status}` };
})();

test('L13：registry 上已有包时，三处必须删掉「尚未发布 / 404」', {
  skip: registryProbe.kind === 'unreachable' ? `npm registry 不可达：${registryProbe.detail.slice(0, 160)}` : false,
}, () => {
  for (const [name, text] of publicationTexts()) {
    const marks = PUBLICATION_MARKERS.find(([file]) => file === name)[1];
    if (registryProbe.kind === 'published') {
      for (const mark of marks) {
        assert.ok(!text.includes(mark), `${name} 仍含「${mark}」，但 registry 已发布 ${registryProbe.version}`);
      }
    } else {
      for (const mark of marks) {
        assert.ok(text.includes(mark), `${name} 少了「${mark}」，但 registry 仍是 E404`);
      }
    }
  }
});

test('L13：台账状态必须与 registry 对齐，发布后允许删除该条', {
  skip: registryProbe.kind === 'unreachable' ? `npm registry 不可达：${registryProbe.detail.slice(0, 160)}` : false,
}, () => {
  const limits = read('docs/LIMITS.md');
  const m = limits.match(/^## (L\d+) npm 包名已定，包还没发出去$/m);
  if (registryProbe.kind === 'published') {
    assert.ok(!m, `registry 已发布 ${registryProbe.version}，L13 应从台账删除`);
    return;
  }
  assert.ok(m, 'registry 仍是 E404，但 L13 标题不见了');
  const id = m[1];
  const block = limits.slice(limits.indexOf(m[0]), limits.indexOf('\n## ', limits.indexOf(m[0]) + 5) > 0 ? limits.indexOf('\n## ', limits.indexOf(m[0]) + 5) : undefined);
  assert.ok(/`status: open`/.test(block), `${id} 必须仍是 open——包没发出去就是没做完`);
  assert.ok(block.includes('npm view agent-case version'), `${id} 的验收命令必须是 npm view`);
});

test('CI 必须真的调用 gate，而不是只把 gate 代码留在仓库里', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci,
    /node bin\/agent-web\.mjs gate cases\/ledger\s+--adapter=ledger-a\s+--compare=ledger-b\s+--min-comparable=4/,
    'ci.yml 没有用 ledger 的真实 4 条案例跑 gate；可比证据下限只在本地存在');
});

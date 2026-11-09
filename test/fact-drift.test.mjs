import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

// ---- L13：npm 包没发布时，README/封面/CHANGELOG 都不许假装能跑（v0.78.2）----

test('L13：只要 registry 上还没有这个包，README 与封面就必须显式声明「会 404」', () => {
  // 这条守卫不联网：它守的是「本地有没有把话说清」，联网检查在 CI 的另一条里。
  const zh = read('README.md');
  const en = read('README.en.md');
  const site = read('site/index.html');
  for (const [name, text, marks] of [
    ['README.md', zh, ['npm 包尚未发布', '404']],
    ['README.en.md', en, ['not published yet', '404']],
    ['site/index.html', site, ['尚未发布', '404']],
  ]) {
    for (const m of marks) {
      assert.ok(text.includes(m), `${name} 少了「${m}」——包没发出去时不许把 npx 那行当真`);
    }
  }
  // 反过来：三处都不许出现「一行就够，连仓库都不用 clone」这类肯定句。
  for (const [name, text] of [['README.md', zh], ['README.en.md', en]]) {
    assert.ok(!text.includes('连仓库都不用 clone'), `${name} 仍在说不用 clone`);
    assert.ok(!text.includes('One line, no clone'), `${name} still says "no clone"`);
  }
});

test('L13：LIMITS 里必须有一条 open，且它点的验收命令是 npm view', () => {
  const limits = read('docs/LIMITS.md');
  const m = limits.match(/^## (L\d+) npm 包名已定，包还没发出去$/m);
  assert.ok(m, 'L13 标题不见了');
  const id = m[1];
  const block = limits.slice(limits.indexOf(m[0]), limits.indexOf('\n## ', limits.indexOf(m[0]) + 5) > 0 ? limits.indexOf('\n## ', limits.indexOf(m[0]) + 5) : undefined);
  assert.ok(/`status: open`/.test(block), `${id} 必须仍是 open——包没发出去就是没做完`);
  assert.ok(block.includes('npm view agent-case version'), `${id} 的验收命令必须是 npm view`);
});

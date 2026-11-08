#!/usr/bin/node
// 使用手册生成器：docs/GUIDE.md → _site/manual.html
// 零依赖 Node（只允许 node:* 内置）；解析不完整即退出非零——CI 守门
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const [srcArg, outArg] = process.argv.slice(2);
if (!srcArg || !outArg) {
  console.error('用法: build-manual <guide.md> <out.html>');
  process.exit(2);
}
const REPO = 'https://github.com/liuzheng6621/agent-web/blob/main';
const srcPath = resolve(srcArg);
const outPath = resolve(outArg);
const docDir = dirname(srcPath);          // …/docs
const repoRoot = resolve(docDir, '..');
const md = readFileSync(srcPath, 'utf8');

// GFM 风格锚点：小写、删符号（保留字母数字/空格/连字符，CJK 保留）、空格转 `-`
function slugText(t) {
  return t.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/ +/g, '-');
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 相对链接 → GitHub blob（md/png/svg 等）；锚点与外部 URL 原样
function resolveHref(h) {
  if (/^(https?:)?\/\//i.test(h) || h.startsWith('#') || h.startsWith('mailto:')) return h;
  const abs = resolve(docDir, h);
  const rel = relative(repoRoot, abs).split(String.fromCharCode(92)).join('/');
  if (rel.startsWith('..')) return esc(h);
  return `${REPO}/${rel}`;
}

const isFig = (h) => /\.(png|jpe?g|svg|gif)$/i.test(h) && !/^(https?:)?\/\//i.test(h) && !h.startsWith('#');

// 行内：转义 → code → 链接 → 粗体 → 回填
function inline(raw) {
  let s = esc(raw);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000C${codes.length - 1}\u0000`;
  });
  const links = [];
  s = s.replace(/!?\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const html = isFig(href)
      ? `<img class="docfig" src="${esc('media/' + href.split('/').pop())}" alt="${text}" loading="lazy">`
      : `<a href="${esc(resolveHref(href))}">${text}</a>`;
    links.push(html);
    return `\u0000L${links.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\u0000C(\d+)\u0000/g, (_, i) => codes[+i]);
  s = s.replace(/\u0000L(\d+)\u0000/g, (_, i) => links[+i]);
  return s;
}

// 块级解析
const toc = [];      // [{id,text}] 二级标题
const anchors = new Set();
const body = [];
const lines = md.split('\n');
let i = 0, para = [], inFence = false, fenceBuf = [], inList = null, listBuf = []
let sec = 0;

function flushPara() {
  if (!para.length) return;
  body.push(`<p>${inline(para.join(' '))}</p>`);
  para = [];
}
function flushList() {
  if (!inList) return;
  const tag = inList === 'ol' ? 'ol' : 'ul';
  body.push(`<${tag}>${listBuf.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
  inList = null; listBuf = [];
}

while (i < lines.length) {
  const ln = lines[i];

  if (ln.startsWith('```')) {
    if (inFence) {
      body.push(`<pre tabindex="0">${fenceBuf.join('\n')}</pre>`);
      fenceBuf = []; inFence = false;
    } else { flushPara(); flushList(); inFence = true; }
    i++; continue;
  }
  if (inFence) { fenceBuf.push(esc(ln)); i++; continue; }

  if (!ln.trim()) { flushPara(); flushList(); i++; continue; }

  const h = ln.match(/^(#{1,4}) (.+)$/);
  if (h) {
    flushPara(); flushList();
    const level = h[1].length, text = h[2].trim();
    if (level === 1) { i++; continue; }             // H1 由页面抬头接管
    const id = slugText(text);
    anchors.add(id);
    if (level === 2) { sec++; toc.push({ id, text }); }
    body.push(`<h${level} id="${esc(id)}">${inline(text)}</h${level}>`);
    i++; continue;
  }

  if (/^---+$/.test(ln.trim())) { flushPara(); flushList(); body.push('<hr>'); i++; continue; }

  if (/^>( |$)/.test(ln)) {
    flushPara(); flushList();
    const q = [];
    while (i < lines.length && /^>( |$)/.test(lines[i])) { q.push(lines[i].replace(/^> ?/, '')); i++; }
    const parts = [];
    let blk = [], kind = null;
    const pushBlk = () => {
      if (!blk.length) return;
      if (kind === 'li') parts.push(`<ul>${blk.map((x) => `<li>${inline(x.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`);
      else parts.push(`<p>${inline(blk.join(' '))}</p>`);
      blk = []; kind = null;
    };
    for (const x of q) {
      if (!x.trim()) { pushBlk(); continue; }
      const isLi = /^[-*] /.test(x);
      if (kind && (kind === 'li') !== isLi) pushBlk();
      kind = isLi ? 'li' : 'p';
      blk.push(x);
    }
    pushBlk();
    body.push(`<blockquote>${parts.join('')}</blockquote>`);
    continue;
  }

  if (ln.startsWith('|')) {
    flushPara(); flushList();
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++; }
    const cells = (r) => r.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    const dataRows = rows.slice(rows[1] && /^[|\s:-]+$/.test(rows[1]) ? 2 : 1);
    body.push('<div class="tw"><table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      + dataRows.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table></div>');
    continue;
  }

  const ul = ln.match(/^[-*] (.+)$/);
  const ol = ln.match(/^\d+[.)] (.+)$/);
  if (ul || ol) {
    flushPara();
    const kind = ul ? 'ul' : 'ol';
    if (inList && inList !== kind) flushList();
    inList = kind;
    listBuf.push((ul || ol)[1]);
    i++; continue;
  }

  para.push(ln.trim());
  i++;
}
flushPara(); flushList();
if (inFence) { console.error('文档里的代码围栏没有闭合'); process.exit(1); }

const VERSION = '{{VERSION}}';
const tocHtml = toc.map((t, n) => `<li><a href="#${esc(t.id)}"><span class="n">${String(n + 1).padStart(2, '0')}</span>${inline(t.text)}</a></li>`).join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>使用手册 · agent-web v${VERSION}</title>
<style>
:root{--paper:#f7f7f3;--paper-2:#f0f1ec;--rule:#d7d9d2;--rule-strong:#9aa196;--ink:#1a1c1a;--ink-2:#4a504b;--ink-3:#6b726b;--seal:#9e2b25}
:root.dark,:root[data-theme="dark"],:root[data-color-mode="dark"]{--paper:#1c211e;--paper-2:#232a25;--rule:#333c35;--rule-strong:#5c665e;--ink:#eceee8;--ink-2:#a9b2a8;--ink-3:#8f9a90;--seal:#d9695f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]):not(.light){--paper:#1c211e;--paper-2:#232a25;--rule:#333c35;--rule-strong:#5c665e;--ink:#eceee8;--ink-2:#a9b2a8;--ink-3:#8f9a90;--seal:#d9695f}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.78 -apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}
a{color:var(--ink);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{color:var(--seal)}
:focus-visible{outline:2px solid var(--seal);outline-offset:2px}
.sheet{border-left:3px solid var(--seal);min-height:100vh}
.inner{max-width:1180px;margin:0 auto;padding:40px 32px 64px}
.mast{border-bottom:1px solid var(--rule-strong);padding-bottom:24px}
.mast dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0 0 24px;font-size:14px;color:var(--ink-2)}
.mast dt{color:var(--ink-3)}
.mast dd{margin:0;font-variant-numeric:tabular-nums}
h1{font:600 clamp(30px,4vw,42px)/1.2 "Songti SC","STSong","Noto Serif CJK SC",Georgia,serif;margin:0 0 12px;letter-spacing:.01em}
.lede{margin:0;color:var(--ink-2);max-width:62ch;font-size:17px}
.back{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin-top:8px;font-size:15px;color:var(--seal);text-decoration:none;border-bottom:1px solid currentColor}
.grid{display:grid;grid-template-columns:248px minmax(0,1fr);gap:56px;margin-top:40px;align-items:start}
.grid>*{min-width:0}
aside.toc{position:sticky;top:24px;max-height:calc(100vh - 48px);overflow:auto;border-right:1px solid var(--rule);padding-right:16px}
aside.toc h2{font:600 13px/1 system-ui,sans-serif;letter-spacing:.14em;color:var(--ink-3);margin:0 0 12px;text-transform:none}
aside.toc ol{list-style:none;margin:0;padding:0;font-size:14px}
aside.toc a{display:flex;align-items:center;min-height:44px;color:var(--ink-2);text-decoration:none;line-height:1.45;padding:2px 0}
aside.toc a:hover{color:var(--seal)}
aside.toc .n{display:inline-block;width:2.2em;color:var(--ink-3);font-variant-numeric:tabular-nums;font-size:12px}
main{max-width:780px}
main p{margin:0 0 16px}
main p,main li,main td,main code{overflow-wrap:break-word}
main strong{font-weight:600}
main h2{font:600 24px/1.35 "Songti SC","STSong","Noto Serif CJK SC",Georgia,serif;margin:48px 0 16px;padding-bottom:8px;border-bottom:1px solid var(--rule);scroll-margin-top:24px}
main h3{font:600 18px/1.5 "Songti SC","STSong","Noto Serif CJK SC",Georgia,serif;margin:32px 0 12px;scroll-margin-top:24px}
main h4{font:600 16px/1.6 system-ui,sans-serif;margin:24px 0 10px}
main ul,main ol{margin:0 0 16px;padding-left:1.5em}
main li{margin:0 0 6px}
main ol>li::marker{font-variant-numeric:tabular-nums;color:var(--ink-3)}
main hr{border:0;border-top:1px solid var(--rule);margin:32px 0}
main blockquote{margin:0 0 16px;padding:2px 0 2px 16px;border-left:2px solid var(--seal);color:var(--ink-2)}
main p a,main li a,main td a,main th a{white-space:nowrap}
main blockquote p:last-child{margin-bottom:0}
main code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,"Cascadia Mono",monospace;background:var(--paper-2);padding:1px 5px;border:1px solid var(--rule)}
main pre{background:var(--paper-2);border:1px solid var(--rule);border-left:2px solid var(--rule-strong);padding:14px 16px;overflow:auto;margin:0 0 20px}
main pre code{background:none;border:0;padding:0;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,"Cascadia Mono",monospace}
.tw{overflow-x:auto;margin:0 0 20px}
main table{border-collapse:collapse;width:100%;font-size:15px}
main th,main td{border-bottom:1px solid var(--rule);padding:8px 12px 8px 0;text-align:left;vertical-align:top}
main th{font-weight:600;border-bottom:1px solid var(--rule-strong);white-space:nowrap}
img.docfig{display:block;max-width:100%;height:auto;margin:8px 0 20px;border:1px solid var(--rule);background:var(--paper-2)}
.foot{margin-top:56px;border-top:1px solid var(--rule-strong);padding-top:16px;font-size:14px;color:var(--ink-3);display:flex;flex-wrap:wrap;gap:8px 20px}
.foot a{display:inline-flex;align-items:center;min-height:44px;min-width:44px;padding:0 14px;color:var(--ink-2)}
.foot a:hover{color:var(--seal)}
@media (max-width:960px){
 .grid{grid-template-columns:1fr;gap:24px}
 aside.toc{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--rule);padding:0 0 16px}
 aside.toc details summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:15px;color:var(--seal)}
 aside.toc ol{display:grid;grid-template-columns:1fr;gap:0}
 aside.toc li{border-top:1px solid var(--rule)}
}
@media (min-width:961px){aside.toc details>summary{display:none}aside.toc details>*:not(summary){display:block}}
@media (max-width:560px){.inner{padding:24px 20px 48px}main h2{font-size:21px}}
</style>
</head>
<body>
<div class="sheet"><div class="inner">
<header class="mast">
<dl>
<dt>手册</dt><dd>使用手册 · 从跑通一题到接入自己的系统</dd>
<dt>来源</dt><dd>docs/GUIDE.md（本页由 CI 生成，改文档即改页面）</dd>
<dt>版本</dt><dd>v${VERSION}</dd>
</dl>
<h1>使用手册</h1>
<p class="lede">断言怎么写、案例怎么出、适配器怎么接、盲区怎么看——都在这三十节里。左侧是目录，代码块可以直接抄。</p>
<a class="back" href="./index.html">← 回到检验报告封面</a>
</header>
<div class="grid">
<aside class="toc">
<details open>
<summary>目录（${toc.length} 节）</summary>
<ol>
${tocHtml}
</ol>
</details>
</aside>
<main>
${body.join('\n')}
</main>
</div>
<footer class="foot">
<span>本页由 scripts/build-manual.mjs 从 docs/GUIDE.md 生成</span>
<a href="./index.html">封面</a>
<a href="./coffee.dashboard.html">真实判决总览</a>
<a href="https://github.com/liuzheng6621/agent-web">GitHub</a>
<a href="https://gitee.com/liu-everything_immpossble/agent-web">Gitee</a>
</footer>
</div></div>
</body>
</html>
`;

// 自检：文内锚必须全部能落地
const refs = new Set([...md.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1]));
const missing = [...refs].filter((r) => !anchors.has(r));
if (missing.length) {
  console.error(`手册里的文内锚点找不到对应标题（${missing.length} 个）：${missing.join(' , ')}`);
  process.exit(1);
}
if (toc.length < 5) {
  console.error(`目录只有 ${toc.length} 节，文档结构不对`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`手册已生成：${outPath}`);
console.log(`  章节 ${toc.length} · 标题锚 ${anchors.size} · 文内锚引用 ${refs.size}（全部可解析）`);
console.log(`  源码 ${srcPath}`);

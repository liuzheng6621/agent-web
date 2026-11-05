/**
 * 从规范视图的**形状**生成变异体。
 *
 * 手写的十二个变异体是"我们想得到的"。想得到的总会用完，所以换一个来源：
 * 观测到的字段有哪些、类型是什么，就照着这些位置造故障。
 *
 * 生成不等于入库。breed 只负责产；能不能留下由 certify 判——杀不掉任何断言的
 * 变异体既不是缺陷也不是资产，是噪音。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPath, setPath } from './values.mjs';
import { isPortablePath } from './certify.mjs';
import { resolveArguments } from './case.mjs';

export const BREED_VERSION = 'agent-web/breed-1';

/** 只在这几个集合里造故障：它们本来就是规范视图的公共部分。 */
const COLLECTIONS = ['orders', 'menu', 'status_log'];

// 集合名不该硬编码：不同应用的视图完全不一样（realworld 是 articles/tags/comments，
// animal 是 animals/adoptions/users）。有适配器就从 manifest 读，读不到才退回上面那三个。
export function collectionsOf(manifest) {
  const view = manifest && manifest.view;
  const cols = view && view.collections;
  if (!cols || typeof cols !== 'object') return null;
  const names = Object.keys(cols);
  return names.length > 0 ? names : null;
}

/** 每个集合最多看几个元素。第 3 个之后的元素和第一个同构，造出来的变异体重复。 */
const ENTITY_DEPTH = 2;

/** 数值 / 字符串各三个算子，集合级两个。够了——再多只是同一批故障的排列组合。 */
const NUMBER_OPS = [
  { name: 'off-by-one', symptom: '数字差一', mechanism: '把这个数值加 1', apply: 'v + 1', rewrites: '差一' },
  { name: 'double', symptom: '数字翻倍', mechanism: '把这个数值乘 2', apply: 'v * 2', rewrites: '翻倍' },
  { name: 'cent', symptom: '金额丢分', mechanism: '把这个数值除以 100 四舍五入', apply: 'Math.round(v) / 100', rewrites: '丢两位', noop: (v) => Math.round(v) / 100 === v },
];

const STRING_OPS = [
  { name: 'prefix', symptom: '文本被加前缀', mechanism: '在这个字符串前加 zz_', apply: "'zz_' + v", rewrites: '加前缀' },
  { name: 'upper', symptom: '文本大小写被改', mechanism: '把这个字符串转成大写', apply: 'String(v).toUpperCase()', rewrites: '转大写', noop: (v) => String(v).toUpperCase() === String(v) },
  { name: 'blank', symptom: '文本被清空', mechanism: '把这个字符串置为空串', apply: "''", rewrites: '置空', noop: (v) => v === '' },
];

const COLLECTION_OPS = [
  { name: 'drop-last', symptom: '最后一条凭空消失', mechanism: '返回前把这个集合的最后一个元素删掉', rewrites: '丢尾' },
  { name: 'reverse', symptom: '顺序被颠倒', mechanism: '返回前把这个集合逆序', rewrites: '逆序' },
];

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** 把一条规范视图摊平成"可以造故障的位置"。 */
export function collectLeaves(state, { collections = COLLECTIONS, depth = ENTITY_DEPTH } = {}) {
  const out = [];
  for (const name of collections) {
    const arr = state?.[name];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const n = Math.min(depth, arr.length);
    for (let i = 0; i < n; i += 1) {
      const entity = arr[i];
      if (!entity || typeof entity !== 'object') continue;
      for (const [key, value] of Object.entries(entity)) {
        if (!isPortablePath(key)) continue;
        if (typeof value === 'number') out.push({ collection: name, index: i, path: key, kind: 'number', value });
        else if (typeof value === 'string') out.push({ collection: name, index: i, path: key, kind: 'string', value });
        else if (Array.isArray(value)) {
          const first = value[0];
          if (!first || typeof first !== 'object') continue;
          for (const [sub, subValue] of Object.entries(first)) {
            if (!isPortablePath(sub)) continue;
            const leafPath = key + '.0.' + sub;
            if (typeof subValue === 'number') out.push({ collection: name, index: i, path: leafPath, kind: 'number', value: subValue });
            else if (typeof subValue === 'string') out.push({ collection: name, index: i, path: leafPath, kind: 'string', value: subValue });
          }
        }
      }
    }
  }
  return out;
}

/** 位置 × 算子 → 变异体计划。集合级算子每个集合一个。 */
export function planMutants(state, { max = 24, collections = COLLECTIONS } = {}) {
  const plan = [];
  const noop = [];
  for (const leaf of collectLeaves(state, { collections })) {
    const ops = leaf.kind === 'number' ? NUMBER_OPS : STRING_OPS;
    for (const op of ops) {
      // 算子在这个值上是恒等的就别生成：'MAKING'.toUpperCase() 还是 'MAKING'，'拿铁' 根本没有大小写。
      // 生成了也只是等价变异体，除了把 undetermined 撑大没有别的作用。
      if (typeof op.noop === 'function' && op.noop(leaf.value)) {
        noop.push({ collection: leaf.collection, index: leaf.index, path: leaf.path, op: op.name });
        continue;
      }
      plan.push({
        id: 'm-breed-' + op.name + '-' + slug(leaf.collection) + '-' + leaf.index + '-' + slug(leaf.path),
        op,
        target: leaf,
        layer: 'state',
      });
    }
  }
  for (const name of collections) {
    const arr = state?.[name];
    if (!Array.isArray(arr) || arr.length < 2) continue;
    for (const op of COLLECTION_OPS) {
      plan.push({
        id: 'm-breed-' + op.name + '-' + slug(name),
        op,
        target: { collection: name, index: null, path: null, kind: 'collection' },
        layer: 'state',
      });
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const p of plan) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    uniq.push(p);
  }
  uniq.noop = noop;
  return uniq;
}

const INLINE_HELPERS = `
const getPath = (obj, dotted) => {
  let cur = obj;
  for (const seg of String(dotted).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg];
  }
  return cur;
};

const setPath = (obj, dotted, value) => {
  const segs = String(dotted).split('.');
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i += 1) {
    if (cur[segs[i]] === null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
};

const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
`;

/** 一条变异体的源码。自包含：不 import 任何东西，拷到哪都能跑。 */
export function renderMutant(item) {
  const { id, op, target } = item;
  const where = target.path
    ? target.collection + '[' + target.index + '].' + target.path
    : target.collection;
  const before = target.kind === 'collection' ? '共 ' + target.length + ' 条' : JSON.stringify(target.value);
  const after = target.kind === 'collection'
    ? (op.name === 'drop-last' ? '少 1 条' : '顺序颠倒')
    : (op.name === 'blank' ? '""' : op.name === 'off-by-one' ? String(Number(target.value) + 1)
      : op.name === 'double' ? String(Number(target.value) * 2)
        : op.name === 'cent' ? String(Math.round(Number(target.value)) / 100)
          : op.name === 'prefix' ? JSON.stringify('zz_' + target.value)
            : JSON.stringify(String(target.value).toUpperCase()));

  const catchHint = target.kind === 'collection'
    ? (op.name === 'drop-last'
      ? '一条 count_delta 断言 ' + target.collection + '；只看某一条实体抓不到'
      : '一条 sorted 断言，或 count_delta 加首元素 field_equals；只断言数量抓不到')
    : '一条 field_equals 断言 ' + where + '；只断言状态或数量抓不到';

  const body = target.kind === 'collection'
    ? (op.name === 'drop-last'
      ? `      const arr = state[${JSON.stringify(target.collection)}];
      if (!Array.isArray(arr) || arr.length === 0) return res;
      arr.pop();`
      : `      const arr = state[${JSON.stringify(target.collection)}];
      if (!Array.isArray(arr) || arr.length < 2) return res;
      arr.reverse();`)
    : `      const entity = (state[${JSON.stringify(target.collection)}] ?? [])[${target.index}];
      if (!entity) return res;
      const current = getPath(entity, ${JSON.stringify(target.path)});
      if (typeof current !== ${JSON.stringify(target.kind)}) return res;
      const v = current;
      setPath(entity, ${JSON.stringify(target.path)}, ${op.apply});`;

  return `/**
 * 由 agent-web breed 生成，勿手改（重跑即覆盖）。
 * 位置：${where}    算子在 ${op.rewrites}
 */

export const meta = {
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(where + ' ' + op.symptom)},
  layer: 'state',
  symptom: ${JSON.stringify(where + ' 从 ' + before + ' 变成 ' + after)},
  mechanism: ${JSON.stringify(op.mechanism)},
  catch_hint: ${JSON.stringify(catchHint)},
  generated: true,
  breed_version: ${JSON.stringify(BREED_VERSION)},
};
${INLINE_HELPERS}
export function wrap(adapter) {
  const inner = adapter;
  return {
    ...inner,
    async observe(runId, scopes) {
      const res = await inner.observe(runId, scopes);
      if (!res || !res.state) return res;
      const state = clone(res.state);
${body}
      return { ...res, state };
    },
  };
}
`;
}

export function renderIndex(items) {
  const imports = items
    .map((it, i) => 'import * as g' + i + ' from ' + JSON.stringify('./' + it.id + '.mjs') + ';')
    .join('\n');
  const rows = items.map((it, i) => '  [' + JSON.stringify(it.id) + ', g' + i + '],').join('\n');
  return `/**
 * 由 agent-web breed 生成。这个目录是一次性产物，不要提交进仓库，
 * 它的作用是拿给 certify 当弹药——杀不掉的会被判 undetermined，不会污染基线。
 */
${imports}

const ENTRIES = [
${rows}
];

export const mutants = ENTRIES.map(([, mod]) => ({ ...mod.meta, wrap: mod.wrap }));
export const mutantIds = mutants.map((m) => m.id);
`;
}

/** 复位一次、观测一次，用这份规范视图当形状来源。 */
export async function sampleState(adapter, { timeoutMs = 8000, caseObj = null } = {}) {
  const reset = await adapter.reset({ seed: caseObj?.environment?.seed });
  const runId = reset?.runId ?? null;
  const scopes = caseObj?.observability?.declared_scopes
    ?? adapter.MANIFEST?.scopes ?? adapter.manifest?.scopes ?? [];

  // 只观测一次的话，业务数据还没产生，能看到的形状只有菜单这类静态表。
  // 给一条案例就先把它跑一遍，拿**终态**当形状来源 —— orders.totalAmount 这种字段才会出现。
  if (caseObj && Array.isArray(caseObj.reference_trajectory)) {
    const outputs = new Map();
    for (const step of caseObj.reference_trajectory) {
      let args;
      try {
        args = resolveArguments(step, outputs);
      } catch {
        break;
      }
      const res = await adapter.execute(runId, { capability: step.capability, as: step.as, arguments: args }, { timeoutMs });
      if (res?.outcome !== 'applied' && step.expected_outcome !== 'rejected') break;
      outputs.set(step.id, res?.payload ?? undefined);
    }
  }

  const res = await adapter.observe(runId, scopes, { timeoutMs });
  return { runId, state: res?.state ?? null, missingScopes: res?.missingScopes ?? [], replayed: Boolean(caseObj) };
}

export async function breedMutants({ adapter, adapterName = 'unknown', out, max = 24, collections = null, caseObj = null } = {}) {
  // 没显式指定集合时，先问适配器的 manifest 要
  if (!collections && adapter && typeof adapter.manifest === 'function') {
    let man = null;
    try { man = adapter.manifest(); if (man && typeof man.then === 'function') man = await man; } catch { man = null; }
    collections = collectionsOf(man) || COLLECTIONS;
  }
  if (!collections) collections = COLLECTIONS;
  if (!out) throw new Error('breed 需要一个输出目录 --out=');
  const sample = await sampleState(adapter, { caseObj });
  if (!sample.state) {
    return { adapter: adapterName, out, items: [], written: 0, state: null, reason: '观测不到任何状态，没东西可照着造' };
  }
  const leaves = collectLeaves(sample.state, { collections });
  const all = planMutants(sample.state, { max: Infinity, collections });
  const skippedNoop = all.noop ?? [];
  const plan = all.slice(0, max);
  fs.mkdirSync(out, { recursive: true });
  for (const it of plan) {
    if (it.target.kind === 'collection') {
      const arr = sample.state[it.target.collection] ?? [];
      it.target.length = arr.length;
    }
    fs.writeFileSync(path.join(out, it.id + '.mjs'), renderMutant(it), 'utf8');
  }
  fs.writeFileSync(path.join(out, 'index.mjs'), renderIndex(plan), 'utf8');
  return { adapter: adapterName, out, items: plan, written: plan.length, available: all.length, skipped_noop: skippedNoop.length, leaves: leaves.length, state: sample.state };
}

/** 把生成目录读回来，形状与 docs/mutants 一致（{...meta, wrap}）。 */
export async function loadBredMutants(dir) {
  const indexPath = path.join(dir, 'index.mjs');
  if (!fs.existsSync(indexPath)) throw new Error('目录里没有 index.mjs：' + dir);
  const mod = await import(pathToFileURL(indexPath).href);
  const list = Array.isArray(mod.mutants) ? mod.mutants : [];
  return list;
}

export function formatBreed(report, { detail = false } = {}) {
  const lines = [];
  lines.push('生成变异体  ' + report.out);
  lines.push('');
  if (!report.written) {
    lines.push('  ' + (report.reason ?? '没有产出'));
    return lines.join('\n');
  }
  lines.push('  形状来源  ' + report.adapter + ' 的规范视图，' + (report.leaves ?? 0) + ' 个可造故障的位置');
  lines.push('  产出      ' + report.written + ' 个变异体' + (report.available > report.written ? '（另有 ' + (report.available - report.written) + ' 个超出 --max 没写）' : ''));
  if (report.skipped_noop > 0) lines.push('  跳过      ' + report.skipped_noop + ' 个恒等算子（值已经是大写 / 已经不含小数，改了等于没改）');
  lines.push('');
  if (detail) {
    for (const it of report.items) {
      const where = it.target.path
        ? it.target.collection + '[' + it.target.index + '].' + it.target.path
        : it.target.collection;
      lines.push('  ' + (it.op.rewrites + '        ').slice(0, 10) + where);
    }
    lines.push('');
  }
  lines.push('  生成不等于入库。下一步：');
  lines.push('    node bin/agent-web.mjs certify cases/coffee --adapter=' + report.adapter + ' --mutants-dir=' + report.out);
  lines.push('  杀不掉的会被判 undetermined —— 那不是缺陷，是"这条形状还不值得断言"。');
  return lines.join('\n');
}

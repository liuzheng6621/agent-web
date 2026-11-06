// 字段映射：把「跨命名体系的自动映射」从人肉活变成提议 + 人签。
//
// 一条铁律：低置信度不许猜。
// 猜错的映射比没有映射坏得多 —— 它会让案例在一个「看起来对、其实错」的字段上判 pass。

import { createHash } from 'node:crypto';

export const ALIGN_VERSION = 'agent-web/align-1';
export const HIGH = 0.75;
export const LOW = 0.45;

/** 同义词组：不同团队给同一个概念起的名字。只收确定同义的，不收「有点像」。 */
const SYNONYM_GROUPS = [
  ['id', 'key', 'uuid', 'uid'],
  ['status', 'state', 'phase', 'stage'],
  ['total', 'sum', 'amount', 'totalamount', 'grandtotal'],
  ['count', 'qty', 'quantity', 'num', 'number'],
  ['price', 'unitprice', 'cost', 'rate'],
  ['items', 'lines', 'entries', 'details', 'products'],
  ['name', 'title', 'label'],
  ['time', 'at', 'timestamp', 'createdat', 'createtime', 'date'],
  ['user', 'username', 'owner', 'account', 'member'],
  ['no', 'number', 'code', 'serial'],
  ['subtotal', 'lineamount', 'linesum', 'netamount'],
  ['orders', 'tickets', 'requests', 'jobs', 'cases'],
  ['menu', 'catalog', 'products', 'goods'],
  ['type', 'event', 'kind', 'action', 'category', 'op'],
  ['from', 'prev', 'previous', 'before', 'old'],
  ['to', 'next', 'after', 'new'],
  ['by', 'actor', 'operator', 'author', 'performer'],
];

const TOKEN_SPLIT = /[^a-z0-9]+/;

/** camelCase / snake_case / kebab-case / PascalCase 一律压成小写单段。 */
export function normalizeName(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function tokens(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter(Boolean);
}

/** 复数归一：orders 与 order 指同一件事，别让一个 s 决定映射。 */
export function canon(name) {
  const n = normalizeName(name);
  if (n.length < 4 || !n.endsWith('s')) return n;
  // status / class / analysis 这些词尾的 s 不是复数，剥了反而制造假同义。
  if (/(ss|us|is)$/.test(n)) return n;
  return n.slice(0, -1);
}

function synonymGroup(name) {
  const n = canon(name);
  for (const g of SYNONYM_GROUPS) {
    if (g.some((x) => canon(x) === n)) return g.map(canon).join('|');
  }
  return null;
}

/** 名字相似度：0 / 0.6 / 0.8 / 1.0，只有四档，没有连续调参空间。 */
export function nameScore(a, b) {
  const na = canon(a);
  const nb = canon(b);
  if (na === nb) return 1;
  const ga = synonymGroup(a);
  const gb = synonymGroup(b);
  if (ga && gb && ga === gb) return 0.8;
  if (ga && gb) return 0; // 分属两个同义词组，名字再像也不是一回事
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  // 逐段比：完全相同的段算 1，同义词组内的段算 1，否则算 0。
  const eq = (x, y) => {
    if (canon(x) === canon(y)) return true;
    const gx = synonymGroup(x);
    const gy = synonymGroup(y);
    return Boolean(gx && gy && gx === gy);
  };
  const inter = ta.filter((x) => tb.some((y) => eq(x, y))).length;
  const union = new Set(ta.concat(tb)).size;
  const jac = inter / union;
  if (jac >= 0.999) return 0.7;   // 每一段都对得上，但整体拼写不同
  return jac >= 0.5 ? 0.6 : 0;
}

/** 只留叶子值：嵌套数组/对象摊平成值序列，键名不参与比较（改名不改值）。 */
export function leaves(value, out) {
  const acc = out || [];
  if (Array.isArray(value)) {
    for (const v of value) leaves(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) leaves(v, acc);
  } else if (value !== undefined) {
    acc.push(value);
  }
  return acc;
}

export function typeOf(values) {
  const seen = new Set();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) seen.add('array');
    else seen.add(typeof v);
  }
  if (seen.size === 0) return 'null';
  if (seen.size === 1) return [...seen][0];
  if (seen.has('number') && seen.has('string')) return 'string';
  return 'mixed';
}


/** 一个字段在若干行上的画像：类型、基数、枚举、取值序列。 */
export function profileField(rows, key) {
  const values = rows.map((r) => (r && typeof r === 'object' ? r[key] : undefined));
  const present = values.filter((v) => v !== undefined);
  const nonNull = present.filter((v) => v !== null);
  const type = typeOf(nonNull);
  // 数组/对象走叶子摊平：结构相同、只是键名不同，仍然算「取值一致」。
  const flat = nonNull.map((v) => (v && typeof v === 'object' ? leaves(v) : [v]));
  const printable = flat.length > 0 && flat.some((x) => x.length > 1) ? flat.map((x) => JSON.stringify(x)) : nonNull;
  const distinct = [...new Set(printable.map((v) => JSON.stringify(v)))];
  return {
    key,
    type,
    present: present.length,
    rows: rows.length,
    null_rate: rows.length === 0 ? 0 : 1 - nonNull.length / rows.length,
    distinct: distinct.length,
    unique: distinct.length === nonNull.length && nonNull.length > 0,
    values: printable,
    enum_values: distinct.length > 0 && distinct.length <= 20 ? distinct.map((v) => JSON.parse(v)) : null,
  };
}

export function profileCollection(rows) {
  const fields = new Map();
  if (!Array.isArray(rows) || rows.length === 0) return { rows: 0, fields };
  const keys = new Set();
  for (const r of rows) {
    if (r && typeof r === 'object') for (const k of Object.keys(r)) keys.add(k);
  }
  for (const k of keys) fields.set(k, profileField(rows, k));
  return { rows: rows.length, fields, signature: valueSignature(rows) };
}

function jaccard(a, b) {
  const sa = new Set(a.map((x) => JSON.stringify(x)));
  const sb = new Set(b.map((x) => JSON.stringify(x)));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / new Set([...sa, ...sb]).size;
}

/** 无序多重集重合：行被打乱时，位置对不上但值还在。 */
function multisetAgreement(pa, pb) {
  const a = pa.values.map((v) => String(v));
  const b = pb.values.map((v) => String(v));
  if (a.length === 0 || b.length === 0) return null;
  const count = new Map();
  for (const x of a) count.set(x, (count.get(x) || 0) + 1);
  let hit = 0;
  for (const y of b) {
    const c = count.get(y) || 0;
    if (c > 0) {
      hit += 1;
      count.set(y, c - 1);
    }
  }
  return (2 * hit) / (a.length + b.length);
}

function valueAgreement(pa, pb) {
  const n = Math.min(pa.values.length, pb.values.length);
  if (n === 0) return null;
  let hit = 0;
  for (let i = 0; i < n; i += 1) {
    const x = pa.values[i];
    const y = pb.values[i];
    if (typeof x === 'number' && typeof y === 'number') {
      if (x === y) hit += 1;
    } else if (String(x) === String(y)) hit += 1;
  }
  return hit / n;
}

/**
 * 一个字段对的分数。五路信号，权重固定，不做「按数据集调参」——
 * 调参出来的阈值换个系统就不准，那还不如明说「这条我不确定」。
 */
export function scoreFieldPair(pa, pb, opts) {
  const o = opts || {};
  const why = [];
  const ts = pa.type === pb.type ? 1 : (pa.type === 'null' || pb.type === 'null' ? 0.5 : 0);
  if (ts === 0) return { score: 0, why: ['类型不同（' + pa.type + ' vs ' + pb.type + '）'], gate: 'type' };

  const ns = nameScore(pa.key, pb.key);
  why.push('名字 ' + ns.toFixed(2));

  const pos = valueAgreement(pa, pb);
  const ms = multisetAgreement(pa, pb);
  const vs = Math.max(pos === null ? 0 : pos, ms === null ? 0 : ms);
  if (pos !== null && pos >= 0.999) why.push('逐行取值一致');
  else if (ms !== null && ms >= 0.999) why.push('取值多重集一致（行序不同）');
  else if (vs > 0) why.push('取值部分重合 ' + vs.toFixed(2));

  let es = 0;
  if (pa.enum_values && pb.enum_values) {
    es = jaccard(pa.enum_values, pb.enum_values);
    why.push('枚举重合 ' + es.toFixed(2));
  }

  let cs = 0;
  if (pa.unique && pb.unique) cs = 1;
  else if (!pa.unique && !pb.unique) cs = 0.5;
  if (cs > 0) why.push('基数 ' + cs.toFixed(2));

  const score = 0.3 * ns + 0.4 * vs + 0.1 * es + 0.1 * cs + 0.1 * ts;
  const rounded = Math.round(score * 1000) / 1000;
  // 高置信需要两条独立证据：名字或逐行取值，二选一必须站得住；只有枚举重合不够。
  const independent = ns > 0 || vs >= 0.999;
  const confident = rounded >= (o.high ?? HIGH) && independent && (vs > 0 || ns >= 0.8);
  if (rounded >= (o.high ?? HIGH) && !confident) why.push('分够高但没有独立证据（名字与取值/枚举都不支持）');
  return { score: rounded, why, confident: Boolean(confident), gate: null, vs: vs === null ? 0 : vs };
}

/** 集合级签名：把所有行的所有叶子值排序后取哈希。改名不改它，改值就改它。 */
export function valueSignature(rows) {
  const all = [];
  for (const r of rows) for (const v of leaves(r)) all.push(JSON.stringify(v));
  all.sort();
  return createHash('sha256').update(all.join('')).digest('hex').slice(0, 16);
}

function collectionSignature(name, prof) {
  return {
    name,
    norm: normalizeName(name),
    rows: prof.rows,
    signature: prof.signature,
    fields: [...prof.fields.keys()],
    fieldCount: prof.fields.size,
  };
}

/** 集合配对：先看结构（行数、字段数），再看名字。看不清就并列候选，不硬配。 */
export function scoreCollectionPair(a, b) {
  const why = [];
  const ns = nameScore(a.name, b.name);
  if (a.signature && b.signature && a.signature === b.signature) {
    // 取值集合逐字相同：这是改名级重构最硬的证据，名字像不像都不重要了。
    why.push('取值集合完全相同');
    return { score: 0.95, why };
  }
  why.push('名字 ' + ns.toFixed(2));
  const rowSim = a.rows === b.rows && a.rows > 0 ? 1 : a.rows === 0 && b.rows === 0 ? 1 : 0;
  if (rowSim) why.push('行数相同 ' + a.rows);
  const maxFields = Math.max(a.fieldCount, b.fieldCount);
  const fieldSim = maxFields === 0 ? 0 : Math.min(a.fieldCount, b.fieldCount) / maxFields;
  why.push('字段数比 ' + fieldSim.toFixed(2));
  const score = 0.45 * ns + 0.35 * rowSim + 0.2 * fieldSim;
  return { score: Math.round(score * 1000) / 1000, why };
}

/**
 * 两棵规范视图对齐。
 * 输入是 {collectionName: rows[]}，输出是映射表 + 未决项 + 每条的证据。
 */
/**
 * 下钻：数组元素里那些字段也要配。
 *
 * 不做的后果是「容器配上了，里面全靠人肉」——`items → lines` 打 94%，
 * 但 `count → qty` 没人管，案例一写就错在叶子上。
 *
 * 做法与顶层同一条：同一个打分函数、同一道置信门槛，只是作用在「摊平后的元素行」上。
 */
export function elementProfiles(rows, key) {
  const elems = [];
  for (const r of rows) {
    const v = r && typeof r === 'object' ? r[key] : undefined;
    if (!Array.isArray(v)) continue;
    for (const e of v) if (e && typeof e === 'object' && !Array.isArray(e)) elems.push(e);
  }
  return profileCollection(elems);
}

/**
 * 一组字段的配对：返回 mappings / unresolved / ambiguous。
 * ambiguous 指的是「两个源字段都自信地指向同一个目标字段」——那是语义重叠，
 * 机器分不出哪个才对，必须留给人。
 */
export function alignFieldSet(rp, tp, opts, refPrefix = '', tgtPrefix = '') {
  const o = opts || {};
  const high = o.high ?? HIGH;
  const low = o.low ?? LOW;
  const pairs = [];
  for (const [rk, rprof] of rp.fields) {
    for (const [tk, tprof] of tp.fields) {
      const sc = scoreFieldPair(rprof, tprof, { high });
      if (sc.score <= 0) continue;
      pairs.push({ ref: rk, target: tk, score: sc.score, why: sc.why, confident: sc.confident, vs: sc.vs });
    }
  }
  pairs.sort((x, y) => y.score - x.score || String(x.ref).localeCompare(String(y.ref)));

  // 「取值完全一致且唯一」的采纳规则。
  //
  // 名字毫无关系、基数信号又弱时（元素行只有两三条，cs 只给 0.5），
  // 分数会卡在 0.65 上不去，于是 dishName → label 这种明显该配的被判未定。
  // 但取值多重集完全一致是这里能拿到的最强证据，且**唯一**时不存在撞车风险。
  // 所以补一条：exact 且该源字段只有一个目标 exact，就采纳。
  const exactByRef = new Map();
  for (const p2 of pairs) {
    if (!(p2.vs >= 0.999)) continue;
    if (!exactByRef.has(p2.ref)) exactByRef.set(p2.ref, []);
    exactByRef.get(p2.ref).push(p2);
  }
  for (const [rk, cands] of exactByRef) {
    if (cands.length !== 1) continue;
    const p2 = cands[0];
    if (p2.confident) continue;
    // 只对**非纯数字**生效。数字撞车太常见（28 既是单价也是小计、两个计数都从 1 数到 3），
    // 「取值一样」在数值上不构成身份证据；字符串（菜名、状态名）才有区分度。
    const prof = rp.fields.get(rk);
    const numeric = prof && prof.type === 'number';
    if (numeric) {
      p2.why.push('取值完全一致但都是数字 → 不算身份证据，留给人签');
      continue;
    }
    p2.confident = true;
    p2.why.push('取值完全一致且唯一 → 采纳');
  }

  const mappings = [];
  const unresolved = [];
  const ambiguous = [];
  const byTarget = new Map();
  for (const p of pairs) {
    if (!p.confident) continue;
    if (!byTarget.has(p.target)) byTarget.set(p.target, []);
    byTarget.get(p.target).push(p);
  }
  // 多个源字段争同一个目标：一律不配，列成 ambiguous
  for (const [target, cands] of byTarget) {
    if (cands.length > 1) {
      for (const c of cands) {
        ambiguous.push({
          path: `${refPrefix}${c.ref}`,
          target_path: `${tgtPrefix}${target}`,
          confidence: c.score,
          rivals: cands.filter((x) => x.ref !== c.ref).map((x) => `${refPrefix}${x.ref}`),
          reason: '两个源字段都自信地指向同一个目标字段，语义重叠，必须人签',
        });
      }
      byTarget.delete(target);
    }
  }

  const takenRef = new Set();
  const takenTgt = new Set(ambiguous.map((a) => a.path));
  for (const p of pairs) {
    if (takenRef.has(p.ref) || takenTgt.has(p.target)) continue;
    if (!byTarget.has(p.target)) continue;
    if (!p.confident) continue;
    takenRef.add(p.ref);
    takenTgt.add(p.target);
    mappings.push({
      field: `${refPrefix}${p.ref}`,
      target_field: `${tgtPrefix}${p.target}`,
      confidence: p.score,
      evidence: p.why,
    });
  }
  for (const [rk] of rp.fields) {
    if (takenRef.has(rk)) continue;
    const cands = pairs.filter((p) => p.ref === rk && p.score >= low).slice(0, 3)
      .map((p) => ({ field: `${tgtPrefix}${p.target}`, confidence: p.score, why: p.why }));
    unresolved.push({
      field: `${refPrefix}${rk}`,
      candidates: cands,
      reason: cands.length === 0 ? '没有任何字段像它' : '最高分低于阈值，需要人签',
    });
  }
  return { mappings, unresolved, ambiguous };
}

export function alignViews(ref, target, opts) {
  const o = opts || {};
  const high = o.high ?? HIGH;
  const low = o.low ?? LOW;

  const refNames = Object.keys(ref).filter((k) => Array.isArray(ref[k]));
  const tgtNames = Object.keys(target).filter((k) => Array.isArray(target[k]));
  const refProf = new Map(refNames.map((k) => [k, profileCollection(ref[k])]));
  const tgtProf = new Map(tgtNames.map((k) => [k, profileCollection(target[k])]));

  const refSigs = refNames.map((k) => collectionSignature(k, refProf.get(k)));
  const tgtSigs = tgtNames.map((k) => collectionSignature(k, tgtProf.get(k)));

  const colCandidates = [];
  for (const ra of refSigs) {
    for (const tb of tgtSigs) {
      const s = scoreCollectionPair(ra, tb);
      colCandidates.push({ ref: ra.name, target: tb.name, score: s.score, why: s.why });
    }
  }
  colCandidates.sort((x, y) => y.score - x.score || String(x.ref).localeCompare(String(y.ref)));

  const usedRef = new Set();
  const usedTgt = new Set();
  const collections = [];
  const unresolvedCollections = [];
  for (const c of colCandidates) {
    if (usedRef.has(c.ref) || usedTgt.has(c.target)) continue;
    if (c.score >= high) {
      usedRef.add(c.ref);
      usedTgt.add(c.target);
      collections.push({ ref: c.ref, target: c.target, confidence: c.score, why: c.why });
    }
  }
  for (const ra of refSigs) {
    if (usedRef.has(ra.name)) continue;
    const cands = colCandidates.filter((c) => c.ref === ra.name).slice(0, 3);
    unresolvedCollections.push({ ref: ra.name, candidates: cands });
  }
  for (const tb of tgtSigs) {
    if (!usedTgt.has(tb.name)) unresolvedCollections.push({ target: tb.name, candidates: colCandidates.filter((c) => c.target === tb.name).slice(0, 3) });
  }

  const mappings = [];
  const unresolved = [];
  const suspicious = [];
  const ambiguous = [];
  const nested = [];
  for (const col of collections) {
    const rp = refProf.get(col.ref);
    const tp = tgtProf.get(col.target);
    const top = alignFieldSet(rp, tp, { high, low }, '');
    for (const m of top.mappings) {
      mappings.push({ collection: col.ref, target_collection: col.target, field: m.field, target_field: m.target_field, confidence: m.confidence, evidence: m.evidence });
    }
    for (const u of top.unresolved) {
      unresolved.push({ collection: col.ref, field: u.field, candidates: u.candidates, reason: u.reason });
    }
    for (const a of top.ambiguous) {
      ambiguous.push({ collection: col.ref, target_collection: col.target, ...a });
    }

    // 下钻：数组元素里的字段也要配，否则「容器配上了，里面全靠人肉」。
    for (const m of top.mappings) {
      const rleaf = rp.fields.get(m.field);
      const tleaf = tp.fields.get(m.target_field);
      if (!rleaf || !tleaf || rleaf.type !== 'array' || tleaf.type !== 'array') continue;
      const rElems = elementProfiles(ref[col.ref], m.field);
      const tElems = elementProfiles(target[col.target], m.target_field);
      if (rElems.fields.size === 0 || tElems.fields.size === 0) continue;
      const inner = alignFieldSet(rElems, tElems, { high, low }, `${m.field}[].`, `${m.target_field}[].`);
      nested.push({
        collection: col.ref,
        target_collection: col.target,
        via: `${m.field} → ${m.target_field}`,
        fields: rElems.fields.size,
        mapped: inner.mappings.length,
        ambiguous: inner.ambiguous.length,
      });
      for (const im of inner.mappings) {
        mappings.push({
          collection: col.ref,
          target_collection: col.target,
          field: im.field,
          target_field: im.target_field,
          confidence: im.confidence,
          evidence: im.evidence,
          nested_via: `${m.field} → ${m.target_field}`,
        });
      }
      for (const iu of inner.unresolved) {
        unresolved.push({ collection: col.ref, field: iu.field, candidates: iu.candidates, reason: iu.reason, nested_via: `${m.field} → ${m.target_field}` });
      }
      for (const ia of inner.ambiguous) {
        ambiguous.push({ collection: col.ref, target_collection: col.target, ...ia, nested_via: `${m.field} → ${m.target_field}` });
      }
    }

    // 高置信错配的自查：被映射上的字段，如果目标集合里还有另一个同类型字段的名字更像它，就报可疑
    for (const m of mappings.filter((x) => x.collection === col.ref)) {
      const rivals = [];
      for (const [tk, tprof] of tp.fields) {
        if (tk === m.target_field) continue;
        if (tprof.type !== (tp.fields.get(m.target_field)?.type ?? tprof.type)) continue;
        if (nameScore(m.field, tk) > nameScore(m.field, m.target_field)) rivals.push(tk);
      }
      if (rivals.length > 0) suspicious.push({ collection: col.ref, field: m.field, mapped_to: m.target_field, rivals });
    }
  }
  // 分母 = 顶层字段 + 真正下钻过的元素字段。只算顶层的会让比率超过 100%，
  // 只算元素的又会把「没有数组的集合」拉低。
  const totalFields = collections.reduce((a, c) => a + refProf.get(c.ref).fields.size, 0)
    + nested.reduce((a, n) => a + n.fields, 0);
  return {
    align_version: ALIGN_VERSION,
    source: o.source ?? null,
    target: o.target ?? null,
    collections,
    mappings,
    unresolved,
    unresolved_collections: unresolvedCollections,
    suspicious,
    ambiguous,
    nested,
    summary: {
      collections: collections.length,
      collections_unresolved: unresolvedCollections.length,
      fields: totalFields,
      mapped: mappings.length,
      rate: totalFields === 0 ? null : mappings.length / totalFields,
      unresolved: unresolved.length,
      suspicious: suspicious.length,
      ambiguous: ambiguous.length,
      nested_collections: nested.length,
      nested_mapped: nested.reduce((a, n) => a + n.mapped, 0),
    },
  };
}

function pct(x) {
  return x === null || x === undefined ? '—' : (x * 100).toFixed(1) + '%';
}

export function formatAlign(report, opts) {
  const detail = Boolean(opts && opts.detail);
  const s = report.summary;
  const out = [];
  out.push('字段映射 · ' + s.collections + ' 个集合 · ' + s.mapped + ' / ' + s.fields + ' 条字段 → ' + pct(s.rate));
  out.push('');
  if (s.collections === 0) {
    out.push('  一个集合都没配上。两份视图的行数或结构差太多，先确认它们描述的是同一种东西。');
    return out.join('\n');
  }
  for (const c of report.collections) {
    out.push('  ' + c.ref + ' → ' + c.target + '   置信 ' + pct(c.confidence));
    const ms = report.mappings.filter((m) => m.collection === c.ref);
    const us = report.unresolved.filter((u) => u.collection === c.ref);
    for (const m of ms) {
      out.push('    ' + m.field.padEnd(16) + '→ ' + m.target_field.padEnd(16) + pct(m.confidence) + (detail ? '   ' + m.evidence.join(' · ') : ''));
    }
    for (const u of us) {
      const cand = u.candidates.length === 0 ? '（没有候选）' : u.candidates.map((x) => x.field + ' ' + pct(x.confidence)).join('、');
      out.push('    ' + u.field.padEnd(16) + '→ 未定            ' + cand);
    }
  }
  const amb = report.ambiguous || [];
  if (amb.length > 0) {
    out.push('');
    out.push('  歧义（两个字段都自信地指向同一个目标，机器分不出该留哪个）：');
    for (const a of amb) {
      out.push('    ' + a.path + ' 与 ' + (a.rivals || []).join('、') + ' 都指向 ' + a.target_path + '   ' + pct(a.confidence));
    }
  }
  const nested = report.nested || [];
  if (nested.length > 0) {
    out.push('');
    out.push('  下钻（数组元素里的字段）：');
    for (const n of nested) {
      out.push('    ' + n.collection + ' 经 ' + n.via + '：' + n.mapped + ' / ' + n.fields + ' 条配上' + (n.ambiguous > 0 ? '，' + n.ambiguous + ' 条歧义' : ''));
    }
  }
  if (report.unresolved_collections.length > 0) {
    out.push('');
    out.push('  未决集合：');
    for (const u of report.unresolved_collections) {
      const who = u.ref ? '参照 ' + u.ref : '目标 ' + u.target;
      const cand = (u.candidates || []).map((c) => (c.ref ? c.ref : c.target) + ' ' + pct(c.score)).join('、');
      out.push('    ' + who + '   候选：' + (cand || '（无）'));
    }
  }
  if (report.suspicious.length > 0) {
    out.push('');
    out.push('  可疑（有另一个字段的名字更像，但分数更低）：');
    for (const x of report.suspicious) {
      out.push('    ' + x.collection + '.' + x.field + ' → ' + x.mapped_to + '   更像的：' + x.rivals.join('、'));
    }
  }
  if (s.unresolved > 0) {
    out.push('');
    out.push('  ' + s.unresolved + ' 条未定 —— 未定不是错，是「机器不该替你决定」。确认后写进 align.yml 的 accepted 段。');
  }
  return out.join('\n');
}

/** 稳定序列化：同样的输入永远同样的字节，便于 diff。 */
export function toYamlObject(report) {
  return {
    align_version: ALIGN_VERSION,
    source: report.source,
    target: report.target,
    collections: report.collections.map((c) => ({ ref: c.ref, target: c.target, confidence: c.confidence })),
    mapping: report.mappings.map((m) => ({
      collection: m.collection,
      field: m.field,
      target_collection: m.target_collection,
      target_field: m.target_field,
      confidence: m.confidence,
    })),
    unresolved: report.unresolved.map((u) => ({ collection: u.collection, field: u.field, reason: u.reason, candidates: u.candidates })),
    accepted: [],
  };
}

export function yamlOf(value, indent) {
  const pad = ' '.repeat(indent || 0);
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '\n' + value.map((v) => pad + '  - ' + yamlOf(v, (indent || 0) + 4).replace(/^\s+/, '')).join('\n');
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return '\n' + keys.map((k) => pad + '  ' + k + ':' + (typeof value[k] === 'object' && value[k] !== null ? yamlOf(value[k], (indent || 0) + 2) : ' ' + yamlOf(value[k], 0))).join('\n');
  }
  if (typeof value === 'string') return /^[A-Za-z0-9_.:\/-]+$/.test(value) ? value : JSON.stringify(value);
  return String(value);
}

export function renderAlignYaml(report) {
  const obj = toYamlObject(report);
  const lines = [];
  lines.push('# agent-web align · 建议映射，未确认的不会生效');
  lines.push('align_version: ' + obj.align_version);
  if (obj.source) lines.push('source: ' + obj.source);
  if (obj.target) lines.push('target: ' + obj.target);
  lines.push('collections:');
  for (const c of obj.collections) lines.push('  - ref: ' + c.ref + '\n    target: ' + c.target + '\n    confidence: ' + c.confidence);
  lines.push('mapping:');
  for (const m of obj.mapping) {
    lines.push('  - collection: ' + m.collection + '\n    field: ' + m.field + '\n    target_collection: ' + m.target_collection + '\n    target_field: ' + m.target_field + '\n    confidence: ' + m.confidence);
  }
  lines.push('unresolved:');
  if (obj.unresolved.length === 0) lines.push('  []');
  else {
    for (const u of obj.unresolved) {
      lines.push('  - collection: ' + u.collection + '\n    field: ' + u.field + '\n    reason: ' + JSON.stringify(u.reason));
      lines.push('    candidates:');
      if (u.candidates.length === 0) lines.push('      []');
      else for (const c of u.candidates) lines.push('      - field: ' + c.field + '\n        confidence: ' + c.confidence);
    }
  }
  lines.push('# 人签：把确认过的条目挪到这里，align 才算生效');
  lines.push('accepted: []');
  return lines.join('\n') + '\n';
}

export function alignExit(report, opts) {
  const o = opts || {};
  if (o.requireAll === true) return report.summary.unresolved === 0 && report.summary.collections_unresolved === 0 ? 0 : 1;
  if (o.maxUnresolved !== undefined && o.maxUnresolved !== null) return report.summary.unresolved <= o.maxUnresolved && report.summary.collections_unresolved === 0 ? 0 : 1;
  return 0;
}

export function fingerprintReport(report) {
  const h = createHash('sha256').update(JSON.stringify(report.mappings)).digest('hex');
  return 'sha256:' + h.slice(0, 16);
}

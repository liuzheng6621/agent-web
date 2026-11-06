/**
 * 词库域 · 实现 A：前缀索引用**字典树**，分词用**正向最长匹配**。
 *
 * 与实现 B 故意不同：B 用「按拼音排好序的数组 + 二分找前缀区间」，分词用「反向 DP」。
 * 两边内部结构完全不一样，但同一份案例必须给出同一份规范视图 —— 这正是
 * compare 要验的东西：如果两种写法在某个边界上给出不同结果，至少有一边是错的。
 */
import { validateManifest } from '../../src/adapter/contract.mjs';
import { buildLexicon } from './dataset.mjs';

export const MANIFEST = {
  adapter: 'lexicon-a',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  description: '合成词库（字典树前缀索引 + 正向最长匹配分词）',
  scopes: ['entries', 'segments'],
  roles: ['reader'],
  view: {
    version: 'agent-web/view/1',
    collections: {
      entries: {
        kind: 'list',
        required: ['id', 'word', 'pinyin', 'category', 'strokes', 'rank'],
        semantics: '词库全量（900 条），按 rank 升序',
      },
      segments: {
        kind: 'list',
        required: ['index', 'text', 'tokens'],
        semantics: '本次运行调用过分词的句子',
      },
    },
  },
  capabilities: [
    {
      id: 'lexicon.list',
      kind: 'read',
      evidence_level: 'validated',
      args: { prefix: 'string?', page: 'number?', pageSize: 'number?' },
      roles: ['reader'],
    },
    {
      id: 'lexicon.lookup',
      kind: 'read',
      evidence_level: 'validated',
      args: { word: 'string' },
      roles: ['reader'],
    },
    {
      id: 'lexicon.segment',
      kind: 'read',
      evidence_level: 'validated',
      args: { text: 'string' },
      roles: ['reader'],
    },
  ],
};

class Reject extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 字典树：每个节点是 { children: Map, entry? }。前缀查询就是走到底再收集。 */
function buildTrie(rows) {
  const root = { children: new Map(), entry: null };
  for (const row of rows) {
    let node = root;
    for (const ch of row.pinyin) {
      if (!node.children.has(ch)) node.children.set(ch, { children: new Map(), entry: null });
      node = node.children.get(ch);
    }
    node.entry = row;
  }
  return root;
}

function collect(node, out) {
  if (node.entry) out.push(node.entry);
  for (const child of node.children.values()) collect(child, out);
  return out;
}

function prefixSearch(trie, prefix) {
  let node = trie;
  for (const ch of prefix) {
    node = node.children.get(ch);
    if (!node) return [];
  }
  return collect(node, []).sort((a, b) => a.rank - b.rank);
}

export function createLexiconA() {
  const runs = new Map();
  let serial = 0;
  const LEXICON = buildLexicon();
  const TRIE = buildTrie(LEXICON);
  const WORDS = new Set(LEXICON.map((r) => r.word));

  const manifest = async () => JSON.parse(JSON.stringify(MANIFEST));

  async function reset() {
    serial += 1;
    const runId = `lex-a-${serial}`;
    runs.set(runId, { segments: [] });
    return {
      runId,
      state: view({ segments: [] }),
      roleBindings: { reader: 'lex-reader' },
    };
  }

  function view(state) {
    return {
      entries: LEXICON.map((r) => ({
        id: r.id,
        word: r.word,
        pinyin: r.pinyin,
        category: r.category,
        strokes: r.strokes,
        rank: r.rank,
      })),
      segments: state.segments.map((s) => ({ index: s.index, text: s.text, tokens: [...s.tokens] })),
    };
  }

  async function observe(runId) {
    const ctx = runs.get(runId);
    if (!ctx) return { state: null, missingScopes: MANIFEST.scopes };
    return { state: view(ctx), missingScopes: [] };
  }

  function requireRun(runId) {
    const ctx = runs.get(runId);
    if (!ctx) throw new Reject('no_run', `运行 ${runId} 不存在`);
    return ctx;
  }

  /** 正向最长匹配：词长上限就是 2，先试两字，不行再退一字。 */
  function segment(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const two = text.slice(i, i + 2);
      if (two.length === 2 && WORDS.has(two)) {
        tokens.push(two);
        i += 2;
      } else {
        tokens.push(text[i]);
        i += 1;
      }
    }
    return tokens;
  }

  async function execute(runId, action) {
    let ctx;
    try {
      ctx = requireRun(runId);
    } catch (e) {
      return { outcome: 'infra_error', error: { code: e.code, message: e.message } };
    }
    try {
      switch (action.capability) {
        case 'lexicon.list': {
          const prefix = action.arguments?.prefix;
          const page = action.arguments?.page ?? 1;
          const pageSize = action.arguments?.pageSize ?? 20;
          if (!Number.isInteger(page) || page < 1) throw new Reject('invalid_argument', 'page 必须是正整数');
          if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
            throw new Reject('invalid_argument', 'pageSize 必须是 1..100 的整数');
          }
          if (prefix !== undefined && typeof prefix !== 'string') {
            throw new Reject('invalid_argument', 'prefix 必须是字符串');
          }
          const all = prefix ? prefixSearch(TRIE, prefix) : LEXICON;
          const start = (page - 1) * pageSize;
          const rows = all.slice(start, start + pageSize);
          return {
            outcome: 'applied',
            payload: {
              entries: rows.map((r) => ({ ...r })),
              page,
              pageSize,
              total: all.length,
              hasMore: start + rows.length < all.length,
            },
          };
        }

        case 'lexicon.lookup': {
          const word = action.arguments?.word;
          if (typeof word !== 'string' || word === '') throw new Reject('invalid_argument', 'word 必填');
          const hit = LEXICON.find((r) => r.word === word);
          if (!hit) throw new Reject('not_found', `词库里没有 ${word}`);
          return { outcome: 'applied', payload: { entry: { ...hit } } };
        }

        case 'lexicon.segment': {
          const text = action.arguments?.text;
          if (typeof text !== 'string' || text === '') throw new Reject('invalid_argument', 'text 必填');
          const tokens = segment(text);
          ctx.segments.push({ index: ctx.segments.length, text, tokens });
          return { outcome: 'applied', payload: { text, tokens: [...tokens] } };
        }

        default:
          throw new Reject('unsupported_capability', `不支持的接口 ${action.capability}`);
      }
    } catch (e) {
      if (e instanceof Reject) return { outcome: 'rejected', error: { code: e.code, message: e.message } };
      return { outcome: 'infra_error', error: { code: 'unexpected', message: String(e && e.message) } };
    }
  }

  const close = async () => {};

  return { manifest, reset, observe, execute, close };
}

export function validateLexiconA() {
  return validateManifest(MANIFEST);
}

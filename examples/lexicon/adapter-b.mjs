/**
 * 词库域 · 实现 B：前缀索引用**排好序的数组 + 二分定界**，分词用**反向 DP**。
 *
 * 与实现 A 的差别不是风格问题，是刻意的：
 *   A 用字典树，前缀命中后要把整棵子树收出来再排序；
 *   B 用一次排序 + 两次二分，直接拿到 [lo, hi) 区间，天然有序、不用二次排序。
 *   A 分词从左往右贪心；B 从右往左取「让剩余部分仍可切分」的最长词。
 * 两种写法在同一份输入上必须给出同一个 tokens，否则至少有一边错 ——
 * 这正是 compare 想逼出来的那种差异。
 */
import { validateManifest } from '../../src/adapter/contract.mjs';
import { buildLexicon } from './dataset.mjs';

export const MANIFEST = {
  adapter: 'lexicon-b',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  clock_policies: ['frozen'],   // 纯计算，没有时间维度
  description: '合成词库（有序数组二分前缀 + 反向 DP 分词）',
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

/** 第一个 >= target 的位置。 */
function lowerBound(rows, target) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].pinyin < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 第一个 > target 的位置。前缀区间就是 [lowerBound(p), lowerBound(p + '\uffff'))。 */
function upperBound(rows, target) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].pinyin <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createLexiconB() {
  const runs = new Map();
  let serial = 0;
  const LEXICON = buildLexicon();
  // 按拼音排一次序，之后所有前缀查询都只做两次二分。
  const BY_PINYIN = [...LEXICON].sort((a, b) => (a.pinyin < b.pinyin ? -1 : a.pinyin > b.pinyin ? 1 : 0));
  const WORDS = new Set(LEXICON.map((r) => r.word));

  const manifest = async () => JSON.parse(JSON.stringify(MANIFEST));

  async function reset() {
    serial += 1;
    const runId = `lex-b-${serial}`;
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

  /**
   * 反向 DP：从右往左，每步尽量取最长的可切分前缀。
   * 这里词长上限是 2，但写法与 A 的贪心不同 —— 先决定右边，再决定左边。
   */
  function segment(text) {
    const n = text.length;
    const cut = new Array(n + 1).fill(false);
    cut[n] = true;
    const take = new Array(n + 1).fill(1);
    for (let i = n - 1; i >= 0; i -= 1) {
      if (i + 1 <= n && cut[i + 1]) {
        cut[i] = true;
        take[i] = 1;
      }
      const two = text.slice(i, i + 2);
      if (two.length === 2 && cut[i + 2] && WORDS.has(two)) {
        cut[i] = true;
        take[i] = 2;
      }
    }
    const tokens = [];
    let i = 0;
    while (i < n) {
      const step = take[i];
      tokens.push(text.slice(i, i + step));
      i += step;
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
          let range;
          if (prefix) {
            const lo = lowerBound(BY_PINYIN, prefix);
            const hi = upperBound(BY_PINYIN, prefix + '\uffff');
            range = BY_PINYIN.slice(lo, hi).sort((a, b) => a.rank - b.rank);
          } else {
            range = LEXICON;
          }
          const start = (page - 1) * pageSize;
          const rows = range.slice(start, start + pageSize);
          return {
            outcome: 'applied',
            payload: {
              entries: rows.map((r) => ({ ...r })),
              page,
              pageSize,
              total: range.length,
              hasMore: start + rows.length < range.length,
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

export function validateLexiconB() {
  return validateManifest(MANIFEST);
}

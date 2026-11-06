/**
 * 词库域 · 合成数据
 *
 * 这个域不是为了「再做一个示例」，是为了补上一个现有三个域都没有的形状：
 * **一次查询返回三位数以上的行，并且要翻页**。
 * 咖啡域 12 条案例、动物域 4 条、账本域 3 条 —— 分页断言在这些域上只跑过个位数，
 * 跨页重复、边界丢行、total 说谎这几种坏法在小数据上很难真的暴露。
 *
 * 数据是**合成**的，不是从任何公开词库搬来的：
 *   30 个音节两两组合 = 900 个词，id / 拼音 / 类别 / 笔画 / 排序位全部由下标决定。
 * 这样做的原因很实际 —— 公开中文词库多半没有明确许可证，搬进来就等于把
 * 别人的授权问题写进本仓库的 LICENSE。合成数据的许可证与代码一致，且可复现。
 *
 * 合成不等于随意：900 条足够让 pageSize=10 翻三页、让 rank 排序有可比性、
 * 让「前缀查询命中 30 条」变成一个确定的数字。
 */

/** 30 个音节。拼音刻意互不重复，否则前缀命中的条数会随同音字变化，案例就不可复现。 */
export const SYLLABLES = Object.freeze([
  { char: '长', py: 'chang' }, { char: '江', py: 'jiang' }, { char: '大', py: 'da' },
  { char: '桥', py: 'qiao' }, { char: '山', py: 'shan' }, { char: '水', py: 'shui' },
  { char: '风', py: 'feng' }, { char: '云', py: 'yun' }, { char: '花', py: 'hua' },
  { char: '草', py: 'cao' }, { char: '树', py: 'shu' }, { char: '林', py: 'lin' },
  { char: '海', py: 'hai' }, { char: '河', py: 'he' }, { char: '天', py: 'tian' },
  { char: '地', py: 'di' }, { char: '日', py: 'ri' }, { char: '月', py: 'yue' },
  { char: '星', py: 'xing' }, { char: '光', py: 'guang' }, { char: '火', py: 'huo' },
  { char: '石', py: 'shi' }, { char: '金', py: 'jin' }, { char: '木', py: 'mu' },
  { char: '土', py: 'tu' }, { char: '人', py: 'ren' }, { char: '心', py: 'xin' },
  { char: '手', py: 'shou' }, { char: '口', py: 'kou' }, { char: '眼', py: 'yan' },
]);

const CATEGORIES = Object.freeze(['nature', 'place', 'body', 'object', 'abstract']);

const N = SYLLABLES.length * SYLLABLES.length; // 900

/**
 * 900 条词条，顺序固定：第 i 条的第一个音节是 i % 30，第二个是 floor(i / 30)。
 * rank = i + 1，于是「按 rank 升序」与「按生成顺序」是同一件事，断言可以写死数字。
 */
export function buildLexicon() {
  const rows = [];
  for (let i = 0; i < N; i += 1) {
    const a = SYLLABLES[i % SYLLABLES.length];
    const b = SYLLABLES[Math.floor(i / SYLLABLES.length)];
    rows.push({
      id: 'L' + String(i + 1).padStart(4, '0'),
      word: a.char + b.char,
      pinyin: a.py + b.py,
      category: CATEGORIES[i % CATEGORIES.length],
      strokes: 3 + ((i * 13) % 24),
      rank: i + 1,
    });
  }
  return rows;
}

/** 前缀 'chang' 正好命中 30 条（第一个音节是「长」的那些）。 */
export const PREFIX_SAMPLE = Object.freeze({ prefix: 'chang', expectTotal: 30 });

/** 两个词拼起来的句子，用来验证分词：长江 + 大桥。 */
export const SEGMENT_SAMPLE = Object.freeze({
  text: '长江大桥',
  expectTokens: ['长江', '大桥'],
});

/** 词库里一定不存在的词，用来验证「查不到」不是「返回空对象」。 */
export const ABSENT_WORD = '不存在的词';

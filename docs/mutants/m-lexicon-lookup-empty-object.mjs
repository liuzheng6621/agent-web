/**
 * 词库域：查不到时返回空对象，而不是拒绝。
 *
 * 症状：`GET /words/不存在的词` 返回 200 `{entry:{}}`。调用方拿到一个「成功」，
 *       接着读 entry.word 得到 undefined，页面渲染出一个空白词条；
 *       缓存层还会把这份空结果写进 cache，之后这个 key 一直是空的。
 * 怎么坏：控制器写了 `return repo.findByWord(w).orElse(new Word())` ——
 *         Optional 被「顺手」消掉了，404 就消失了。
 * 怎么抓：案例里把这一步写成 expected_outcome: "rejected"。
 *         这是**判决级**的抓捕，不需要任何断言：期望拒绝而实际执行，直接判假。
 */
export const meta = {
  id: 'm-lexicon-lookup-empty-object',
  title: '查不到时返回空对象而不是拒绝',
  layer: 'execute',
  symptom: '查不存在的词返回 200 {entry:{}}，调用方以为查到了',
  mechanism: 'Optional.orElse(new Word()) 把 404 消成了 200',
  catch_hint: '案例步骤写 expected_outcome: "rejected"（判决级，不用断言）',
  applies_to: { capabilities: ['lexicon.lookup'] },
};

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (action.capability !== 'lexicon.lookup') return res;
      if (res.outcome !== 'rejected') return res;
      if (res.error?.code !== 'not_found') return res;
      return { outcome: 'applied', payload: { entry: {} } };
    },
  };
}

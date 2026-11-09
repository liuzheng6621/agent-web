export const meta = {
  id: 'm-exec-duplicate-write',
  title: '一次点击写了两遍',
  layer: 'execute',
  symptom: '终态看着对，条数多了一倍（没做幂等的写接口都这样）',
  mechanism: '写能力成功后用同样的参数再执行一遍，返回第一次的结果',
  catch_hint: '只能靠 count_delta 或 linkage 的数量关系；只看字段值的断言完全看不见',
  applies_to: { capability_kinds: ['write'] },
};

const WRITEISH = /(create|update|delete|cancel|pick|accept|ready|approve|reject|favorite|follow|complete)/;

export function wrap(adapter) {
  return {
    ...adapter,
    async execute(runId, action) {
      const res = await adapter.execute(runId, action);
      if (res && res.outcome === 'applied' && WRITEISH.test(String(action && action.capability))) {
        try {
          await adapter.execute(runId, { ...action, arguments: { ...(action.arguments || {}) } });
        } catch {
          /* 第二次失败也算“写了”，这里不吞掉主结果 */
        }
      }
      return res;
    },
  };
}

/** 写变异体只用到这三个包装器，别自己动适配器内部状态。 */

export const clone = (v) =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));

/** 只改 observe 返回的规范视图：终态被改坏，但动作本身"成功"了。 */
export function wrapState(inner, tamper) {
  return {
    ...inner,
    async observe(runId, scopes) {
      const res = await inner.observe(runId, scopes);
      const state = clone(res.state);
      tamper(state);
      return { ...res, state };
    },
  };
}

/** 在执行前改请求：让越权的动作以别人的身份执行。 */
export function wrapExecute(inner, patch) {
  return {
    ...inner,
    async execute(runId, action) {
      const patched = patch(action);
      return inner.execute(runId, patched ?? action);
    },
  };
}

/** 在执行后改结局：把该拒的改成成功。 */
export function wrapExecuteAfter(inner, after) {
  return {
    ...inner,
    async execute(runId, action) {
      const res = await inner.execute(runId, action);
      return after(action, res) ?? res;
    },
  };
}

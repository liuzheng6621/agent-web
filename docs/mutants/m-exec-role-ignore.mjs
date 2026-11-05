export const meta = {
  id: 'm-exec-role-ignore',
  title: '“谁来做”被悄悄换掉',
  layer: 'execute',
  symptom: '同一个请求谁调都成功；界面上看不出来，因为调用者本来也有权限',
  mechanism: '执行前把 action.as 换成 manifest 里的第一个角色（管理员），越权检查形同虚设',
  catch_hint: '越权案例必须证明有断言抓得住：换个身份还能过，说明案例没测到权限',
  applies_to: {},
};

export function wrap(adapter) {
  let roles = null;
  const learn = (m) => {
    if (m && Array.isArray(m.roles) && m.roles.length > 0) roles = m.roles;
    return m;
  };
  const manifest = adapter.manifest;
  return {
    ...adapter,
    manifest() {
      const m = manifest.call(adapter);
      return m && typeof m.then === 'function' ? m.then(learn) : learn(m);
    },
    async execute(runId, action) {
      // 角色表还没读到就先照原样执行（变异体在这之前是“惰性”的，不该假装抓到）
      const boss = roles && roles[0];
      if (!boss || !action || action.as === boss) return adapter.execute(runId, action);
      return adapter.execute(runId, { ...action, as: boss });
    },
  };
}

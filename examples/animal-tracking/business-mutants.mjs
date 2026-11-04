export const missedRewardMutation = {
  id: 'm-task-completion-misses-reward',
  title: '任务完成但未发放积分',
  layer: 'state',
  symptom: '任务显示已完成，志愿者积分没有增加',
  wrap(adapter) {
    return {
      ...adapter,
      async observe(runId, scopes) {
        const result = await adapter.observe(runId, scopes);
        if (!result?.state) return result;
        const state = structuredClone(result.state);
        if (state.tasks?.some((task) => task.status === 'COMPLETED')) {
          for (const volunteer of state.points ?? []) volunteer.points = 0;
        }
        return { ...result, state };
      },
    };
  },
};

// agent-web 公共出口：案例格式、判决流水线、指标汇总、适配器契约。
// 适配器实现不从这里导出 —— 它们各自是独立模块，避免把具体后端绑进核心。

export { TRUE, FALSE, UNKNOWN, isValue, fromBool, and, or, not } from './three-valued.mjs';
export { NORMALIZATION_VERSION, deepEqual, stableStringify, fingerprint, getPath, setPath } from './values.mjs';
export { PRED_OPS, validateSelector, selectEntities, describeSelector } from './select.mjs';
export { KINDS, PHASES, PHASE_MATRIX, phaseOf, validateAssertion, evalAssertions, firstFailure } from './assert/index.mjs';
export { SCHEMA_VERSION, STEP_OUTCOMES, BindingError, validateCase, validateSteps, resolveArguments, deriveLabels } from './case.mjs';
export { VERDICTS, judge } from './runner.mjs';
export { wilson, summarize, agreement, formatText } from './report.mjs';
export { parseLog, matchHttp, outcomeOf, inferSteps, toTrajectoryDoc, recordTrajectory } from './record.mjs';
export {
  OUTCOMES,
  CAPABILITY_KINDS,
  EVIDENCE_LEVELS,
  RESET_STRATEGIES,
  validateManifest,
  validateAdapter,
  evidenceLevelOf,
} from './adapter/contract.mjs';

// agent-web 公共出口：案例格式、判决流水线、指标汇总、适配器契约。
// 适配器实现不从这里导出 —— 它们各自是独立模块，避免把具体后端绑进核心。

export { TRUE, FALSE, UNKNOWN, isValue, fromBool, and, or, not } from './three-valued.mjs';
export { NORMALIZATION_VERSION, deepEqual, stableStringify, fingerprint, getPath, setPath } from './values.mjs';
export { PRED_OPS, validateSelector, selectEntities, describeSelector } from './select.mjs';
export { KINDS, PHASES, PHASE_MATRIX, phaseOf, validateAssertion, evalAssertions, firstFailure } from './assert/index.mjs';
export { SCHEMA_VERSION, STEP_OUTCOMES, DRAFT_STATES, BindingError, validateCase, validateSteps, resolveArguments, deriveLabels, draftBlocker, acceptCase } from './case.mjs';
export { VERDICTS, judge } from './runner.mjs';
export { wilson, summarize, agreement, formatText } from './report.mjs';
export { parseLog, matchHttp, outcomeOf, inferSteps, toTrajectoryDoc, recordTrajectory } from './record.mjs';
export { identityOf, synthesize, replayTrajectory, buildDraftCase } from './draft.mjs';
export { buildFlowModel, renderFlowHtml } from './flow.mjs';
export {
  OUTCOMES,
  CAPABILITY_KINDS,
  EVIDENCE_LEVELS,
  RESET_STRATEGIES,
  validateManifest,
  validateAdapter,
  evidenceLevelOf,
} from './adapter/contract.mjs';
export { auditRuns, formatAudit, indexVerdicts } from './audit.mjs';
export {
  TRAPS,
  TRAPS_VERSION,
  scanVerdict,
  summarizeTraps,
  trapVerdict,
  formatTraps,
} from './traps.mjs';
export { COVERAGE_VERSION, collectUsage, summarizeCoverage, formatCoverage, coverageVerdict } from './coverage.mjs';
export {
  MUTATIONS,
  mutate,
  mutationIds,
  describeMutations,
} from './mutate.mjs';
export {
  certify,
  certifyCase,
  certifyExit,
  certificate,
  probe,
  flatAssertions,
  formatCertify,
} from './certify.mjs';

// agent-web 公共出口：案例格式、判决流水线、指标汇总、适配器契约。
// 适配器实现不从这里导出 —— 它们各自是独立模块，避免把具体后端绑进核心。

export { TRUE, FALSE, UNKNOWN, isValue, fromBool, and, or, not } from './three-valued.mjs';
export { NORMALIZATION_VERSION, deepEqual, stableStringify, fingerprint, getPath, setPath } from './values.mjs';
export { PRED_OPS, validateSelector, selectEntities, describeSelector } from './select.mjs';
export { KINDS, PHASES, PHASE_MATRIX, phaseOf, validateAssertion, evalAssertions, firstFailure } from './assert/index.mjs';
// 形状断言：集合的结构（唯一性 / 类型 / 值域 / 顺序），不是某一行某个字段的值
export { SHAPE_KINDS, SHAPE_TYPES, evalShape } from './assert/shape.mjs';
export { relation, RELATION_OPS } from './assert/relation.mjs';
export { discoverRelations } from './relations.mjs';
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
export { PROBE_VERSION, probeAdapter, formatProbe, probeExit } from './probe.mjs';
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
export {
  DISCOVER_VERSION,
  OPENAPI_CANDIDATES,
  toCapabilityId,
  capabilityKind,
  parseOpenApi,
  probeSite,
  pickReadEndpoints,
  buildAdapterSource,
  buildCaseDocs,
  runReads,
  discover,
  formatDiscover,
} from './discover.mjs';
export {
  DRILL_VERSION,
  buildDrills,
  gradeDrills,
  gradeExit,
  formatGrade,
  taskSheet,
  writeDrills,
  readDrills,
  readSubmissions,
  safeName,
} from './drill.mjs';

// 变异体生成：从规范视图形状造故障，能不能留下由 certify 判
export {
  BREED_VERSION,
  collectLeaves,
  planMutants,
  renderMutant,
  renderIndex,
  sampleState,
  breedMutants,
  loadBredMutants,
  formatBreed,
} from './breed.mjs';

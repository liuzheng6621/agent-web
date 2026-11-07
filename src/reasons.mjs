/**
 * 理由码登记表。
 *
 * 为什么要有这张表：这个仓库有四个**互不相同**的命名空间都在用「一个短字符串」
 * 表示「为什么」，而它们从来没有集中登记过 ——
 *
 *   verdict    判决的 reason_code（`verify` 输出的那一栏，进 SPEC 第 7 章）
 *   assertion  单条断言结果的 code（进 SPEC 第 4 章）
 *   probe      `probe` 每一项检查的 id（进 SPEC 第 14 章）
 *   error      适配器 / 工具内部错误的 error.code（不进判决，只给人看）
 *
 * 分开的理由不是洁癖：`invalid_case` 同时是判决码和断言码，`ok` 同时是
 * pass 的判决码和断言成立码，`not_declared` 既是适配器的 error.code 又是
 * `state_machine` 的断言码。混在一个集合里，守卫测试只能写得很松；
 * 分成四个，才能问出「这一处产出的码，属于它该属于的那一类吗」。
 *
 * 这张表的用法不是「查文档」，是被测试当判据：`test/reasons.test.mjs`
 * 扫源码里所有产出码的写法，任何一个没登记的码都会红；反过来，
 * 登记了却一处都没产出的码也会红（那是死码，留着只会让人以为它还在生效）。
 *
 * 所以**新增一个码 = 改两个文件**：写它的地方，和这张表。
 */

/** 判决层：`verdict.reason_code` 的封闭枚举。SPEC 第 7 章那张表就是它。 */
export const VERDICT_REASONS = Object.freeze({
  ok: '全部断言成立，判决 pass',
  invalid_case: '案例格式校验失败，或者断言本身写错了',
  unconfirmed_draft: '案例还是未确认草稿，没有资格得分',
  invalid_environment: 'manifest() 抛错，或 manifest 不符合契约',
  invalid_initial_state: '前置条件为假 —— 初态不干净，不是被测系统的错',
  missing_observation: '看不见：初态观测不到、前置条件求不出，或有断言判不了且原因不同/不在白名单',
  coverage_gap: '步的能力不在 manifest 里，或适配器回了 unsupported',
  invalid_action: '能力不在 allowed_capabilities，或参数绑定失败',
  contract_violation: '适配器返回了契约外的 outcome —— 判定权威被换掉了',
  effect_uncertain: '可能已经生效但结果没回来，不许重放',
  infrastructure_error: '适配器或下层故障，这次调用没发生，可以重试',
  unexpected_rejection: '该成功却被拒绝',
  expected_rejection: '该被拒绝却成功了',
  assertion_false: '目标断言为假',
  invariant_violated: '不变量为假',
  unsupported_event: '后端不记录这类事件（唯一进了白名单的「判不了」原因）',
});

/**
 * 断言层：单条断言结果的 `code`。false 与 unknown 共用这个命名空间。
 *
 * 一个 kind 可以回多个不同的码（`pagination` 就有五个），因为它们指向
 * 五种不同的修法；判假时人要知道该去改哪一处。
 */
export const ASSERTION_CODES = Object.freeze({
  ok: '成立',
  invalid_case: '断言自己写错了（缺 path、缺 type、空 values、窗口方向反了…）',
  missing_observation: '看不见：集合不存在、字段缺失、值不是对象',
  unknown: 'every_step 全部成立不了但又没有一条判假（只可能是空集）',
  field_mismatch: 'field_equals 的值不等',
  count_mismatch: 'count_delta 的差值不符',
  event_observed: 'event_absent 要它别发生，它发生了',
  negated: 'composite 的 not 分支不成立',
  entity_not_found: 'entity_exists / field_equals 的选择器一条都没命中',
  relation_violated: 'relation 的等式不成立',
  shape_violated: 'unique / type_of / subset / sorted_by 违反了声明',
  side_effect: '标了只读的能力改了状态',
  transition_missing: 'status_transition 找不到这条迁移',
  illegal_transition: 'status_transition 走了未声明的边',
  unknown_state: 'state_machine 遇到了没声明的状态',
  not_declared: 'state_machine 没声明 transitions：没声明就没约束',
  incomplete_observation: '观测不完整（事件没记全），没法判断有没有发生',
  unsupported_event: '这个后端不记录这类事件',
  linkage_missing: 'linkage 找不到关联行',
  linkage_violated: 'linkage 关联到的行对不上',
  linkage_count_violated: 'linkage 的条数与声明不符',
  pagination_duplicate: '翻页出现重复行',
  pagination_order: '翻页顺序与 sorted_by 不符',
  pagination_size: '每页条数超过声明或请求的 size',
  pagination_total: '翻完的总条数与 count_delta 推不出来的总数不符',
  pagination_total_reported: '接口报的 total 与实际翻出来的条数不符',
  payload_mismatch: 'payload 断言不成立',
  missing_timezone: 'timeliness 没声明时区，不猜',
  timeliness_violated: '时间窗不成立',
  recurrence_duplicated: '同一槽位被触发多次',
  recurrence_drift: '触发时刻偏离槽位超出容差',
  recurrence_gap: '应触发的槽位没有触发',
  recurrence_count_mismatch: '触发总次数与窗口算出来的不符',
  not_http: 'crosscheck：适配器不走 HTTP，查不了',
  missing_response: 'crosscheck：拿不到另一通道的响应',
  response_mismatch: 'crosscheck：两个通道看到的不一样',
});

/**
 * 探针层：`probe` 每一项检查的 id。与理由码不是一回事 —— 它是「查了什么」，
 * 不是「为什么判成这样」，所以单独一个命名空间。
 */
export const PROBE_CHECKS = Object.freeze({
  contract: '适配器实现了五方法',
  manifest: 'manifest() 可读且通过校验',
  reset: 'reset() 可执行',
  'reset-idempotent': '复位幂等：两次 reset 的初始视图相同',
  'observe-stable': '观测稳定：同一状态连读两次相同',
  volatile: '观测稳定（调用方声明视图含时钟/随机数，跳过）',
  'no-leak': '无状态泄漏：写过之后复位仍回到第一份初态',
  'empty-args': '空参数调用写能力不炸',
  'write-visible': '写操作声明成功但视图没变',
  'declared-vs-behavior': '声明了的能力真的存在',
  'role-effective': '角色真的生效',
  'read-no-side-effect': '读操作不改状态',
  'outcome-contract': '每次 execute 都回契约内的 outcome',
  'close-idempotent': 'close 可以重复调用',
  'clock-honest': '声明 frozen 的适配器时钟真的冻住',
});

/**
 * 内部错误码：适配器、视图契约、工具之间传的 `error.code`。
 *
 * **这一类不进判决**——它到不了 `verdict.reason_code`，只用于定位。
 * 混进判决码里会让人以为「后端返回 unknown_role」是一种判决结论。
 */
export const ERROR_CODES = Object.freeze({
  adapter_error: '适配器内部错误（网络、解析、超时）',
  bad_response: '后端返回了看不懂的东西',
  invalid_argument: '参数不合法（业务校验）',
  no_run: '没有 runId 或已关闭',
  unknown_role: '角色名不在适配器认识的身份表里',
  unknown_capability: '适配器不认识这个能力',
  unsupported_capability: '适配器认识但演不了',
  not_declared: '能力没在 manifest 里声明',
  decl_fetch: '取声明文件失败',
  decl_no_method: '声明文件没有导出预期的方法',
  decl_unsupported: '声明文件用了不支持的写法',
  missing_argument: '必填参数缺失',
  twin_exhausted: '录制里没有更多步',
  out_of_order: '收到的能力与录制的下一步不一致',
  args_mismatch: '参数与录制不一致',
  tap_upstream: '录制时上游出错',
  no_path: '这条能力没有可重放的 HTTP 路径',
  direct_failed: '绕开适配器直连也失败了',
  state_not_object: '观测结果不是对象',
  missing_collection: '视图契约声明了这个集合，观测里没有',
  missing_field: '集合元素缺 required 字段',
  wrong_kind: '集合的 kind 与声明不符',
  expected_failure: '这条结果声明了「本来就会失败」',
  no_assertion: '这条结果一条断言都没有',
});

/** 四个命名空间里确实共用、不必互斥的码。 */
export const SHARED_CODES = Object.freeze([
  'ok', 'invalid_case', 'missing_observation', 'unknown', 'not_declared', 'unsupported_event',
]);

/** 全部码的并集，用于「有没有漏登记」的检查。 */
export const ALL_CODES = Object.freeze([
  ...Object.keys(VERDICT_REASONS),
  ...Object.keys(ASSERTION_CODES),
  ...Object.keys(PROBE_CHECKS),
  ...Object.keys(ERROR_CODES),
]);

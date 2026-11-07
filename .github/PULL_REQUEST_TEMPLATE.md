<!--
  如果你是在替别人（或替一个 Agent）提交：请确认人类已经读过下面每一栏。
  没有填「怎么被证伪」那一栏的 PR 会被直接关闭 —— 不是不欢迎，是这一栏是本仓库的核心。
-->

## 这个 PR 做了什么

<!-- 一段话说清。不要写"优化""完善""改进"。 -->

## 为什么

<!-- 现在有什么问题？最好给一个具体的、现在判不出来的例子。 -->

## 怎么被证伪

<!--
  本仓库特有的一栏，必填。按类型选一个写：

  - 新断言：造了哪个只有它能抓的变异体？`node scripts/kind-necessity.mjs` 的输出是什么？
  - 新变异体：它落在 caught 还是 killable？`certify` 的数字变了吗？
  - 改判决行为：哪条现有测试的预期变了？为什么新预期才对？
  - 新域：两个实现分别是什么？哪里不同？`compare` 一致率多少？
  - 纯文档：哪个测试会因此变红（说明文档真的被读了）？
-->

## 检查清单

- [ ] `npm test` 全绿（当前 513 条）
- [ ] `node scripts/status-line.mjs` 通过（版本号五处一致）
- [ ] `node scripts/certify-baseline.mjs` 漏网的正好是基线里那几个
- [ ] `node scripts/certify-can-fail.mjs` 通过
- [ ] `node scripts/kind-necessity.mjs` 通过
- [ ] `node scripts/state-equivalence.mjs` 快路径与重放逐格相同
- [ ] `node bin/agent-web.mjs selftest` 通过
- [ ] 新增的理由码已登记进 `src/reasons.mjs`
- [ ] 新增的变异体写了 `applies_to`（跨域通病写 `{}`，不要省略）
- [ ] 文档同步了（`CHANGELOG.md` / `docs/ROADMAP.md` / `docs/LIMITS.md` / 两份 README）
- [ ] 我逐行读过这次改动，能解释每一行为什么在那儿

## 相关 issue

<!-- 没有就写「无」。 -->

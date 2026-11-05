// 出题与批改：把变异体变成题面，把断言当答案，对错由机器判定。
//
// 这份文件存在的理由只有一句：训练和评测都需要标签，而标签不能由模型打。
// 一条断言够不够狠，跑一遍就知道 —— 不需要 LLM judge，也不会有争议。

import { join } from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

import { flatAssertions, probe } from './certify.mjs';
import { MUTATIONS } from './mutate.mjs';
import { validateAssertions } from './assert/index.mjs';
import { stableStringify } from './values.mjs';

export const DRILL_VERSION = 'agent-web/drill-1';

/** 文件名安全化：题目 id 里有 / 和 @。 */
export function safeName(id) {
  return String(id).split('/').join('__').split('@').join('-at-');
}

/** 把案例里的断言换成另一组，其余不动。 */
export function withAssertions(caseObj, list) {
  const task = Object.assign({}, caseObj.task);
  delete task.invariants;
  task.goal_assertions = list;
  return Object.assign({}, caseObj, { task: task });
}

function sigOf(v) {
  return (v && v.status) + '/' + (v && v.reason_code);
}

/** 这条案例真正能看到的东西：初态、终态、事件。 */
function observableOf(verdict) {
  const ev = (verdict && verdict.evidence) || {};
  return stableStringify({ initial: ev.initial, final: ev.final, events: ev.events });
}

/** 题面：给模型看的，不含答案。 */
export function taskSheet(item) {
  const out = [];
  out.push('# ' + item.id);
  out.push('');
  out.push(item.question);
  out.push('');
  out.push('## 案例 ' + item['case']);
  out.push('');
  out.push('轨迹 ' + item.given.steps + ' 步；现在这套断言在它上面判 pass。');
  out.push('');
  out.push('**这份实现是坏的**：' + item.symptom + '。');
  out.push('坏在哪：' + item.mechanism + '。');
  out.push('');
  out.push('它现在用的断言：');
  out.push('');
  item.given.assertions.forEach(function (a, i) {
    out.push('  ' + i + '. ' + JSON.stringify(a));
  });
  out.push('');
  out.push('## 要你交的');
  out.push('');
  out.push('交一个 JSON：{"assertions": [ ... ]}。不要改案例，只交断言。');
  out.push('');
  out.push('判分规则（不会通融）：');
  out.push('');
  out.push('1. 你写的每条断言必须在**正确实现**上为真 —— 否则它是废的，记 unarmed。');
  out.push('2. 至少一条必须在**这份坏实现**上为假 —— 否则你什么也没抓到。');
  out.push('3. 声明 phase 时必须符合矩阵：entity_exists/field_equals 只能 final，');
  out.push('   count_delta/unchanged 只能 initial_vs_final，status_transition/event_absent 只能 trace。');
  out.push('4. 没有 llm_judge 这种 kind，也不会加。');
  out.push('');
  out.push('可用断言：entity_exists / field_equals / count_delta / unchanged / status_transition /');
  out.push('event_absent / composite(and|or|not)。');
  out.push('');
  out.push('提示：答案不在原断言的参数里微调，而在**你没断言过的地方**。');
  return out.join('\n') + '\n';
}

/** 出题：只对「整个案例都没抓住」的 (案例, 变异体) 组合出题。 */
export async function buildDrills(opts) {
  const options = opts || {};
  const entries = options.entries || [];
  const adapterFactory = options.adapterFactory;
  const adapterName = options.adapterName || 'unknown';
  const timeoutMs = options.timeoutMs;
  const mutations = options.mutations || MUTATIONS;

  const items = [];
  let skipped = 0;
  let notApplicable = 0;
  let invisible = 0;

  for (const entry of entries) {
    const c = entry.case;
    const base = await probe(c, await adapterFactory(), { adapterName, timeoutMs });
    const baseSig = sigOf(base.verdict);
    // 出题的前提是这条案例本来就该判 pass。
    // 见证型案例（故意失败/故意无法判断）本来就不该 pass，
    // 它们的断言在这套语义下"抓不住变异体"是必然的，出题没有意义。
    if (base.verdict.status !== 'pass') {
      notApplicable += mutations.length;
      continue;
    }
    const declared = flatAssertions(c);

    for (const m of mutations) {
      const p = await probe(c, m.wrap(await adapterFactory()), { adapterName, timeoutMs });
      if (sigOf(p.verdict) !== baseSig) {
        skipped += 1;
        continue;
      }
      // 哪些断言在这个变异体下还活着：全绿说明这套断言对这个坏法集体失明。
      // 变异体改了东西，但这条案例的观测里根本看不到 —— 那就不该出题：
      // 没有任何断言能抓住一个在观测里不存在的差异。这不是漏洞，是案例的边界。
      if (observableOf(p.verdict) === observableOf(base.verdict)) {
        invisible += 1;
        continue;
      }
      const alive = [];
      base.results.forEach(function (r, i) {
        const mr = p.results[i];
        if (r.status === 'true' && mr && mr.status === 'true') alive.push(i);
      });
      items.push({
        drill_version: DRILL_VERSION,
        id: c.id + '@' + m.id,
        case: c.id,
        case_file: entry.file,
        mutant: m.id,
        layer: m.layer,
        title: m.title,
        symptom: m.symptom,
        mechanism: m.mechanism,
        catch_hint: m.catch_hint,
        verdict: { status: p.verdict.status, reason_code: p.verdict.reason_code },
        question:
          '这套断言在这份坏实现上判 ' +
          p.verdict.status +
          '，和正确实现一模一样 —— 它没看出区别。写出能抓住它的断言。',
        given: {
          assertions: declared.map(function (d) { return d.assertion; }),
          labels: declared.map(function (d) { return d.label; }),
          steps: (c.reference_trajectory || []).length,
          roles: (c.environment && c.environment.roles) || [],
          alive: alive,
        },
      });
    }
  }

  return {
    drill_version: DRILL_VERSION,
    adapter: adapterName,
    generated: {
      cases: entries.length,
      mutants: mutations.length,
      pairs: entries.length * mutations.length,
      asked: items.length,
      skipped: skipped,
      not_applicable: notApplicable,
      invisible: invisible,
    },
    items: items,
  };
}

/** 批改：把提交的断言放到两个实现上各跑一遍，不看它说了什么，只看跑出什么。 */
export async function gradeDrills(opts) {
  const options = opts || {};
  const items = options.items || [];
  const submissions = options.submissions || new Map();
  const loadCase = options.loadCase;
  const adapterFactory = options.adapterFactory;
  const adapterName = options.adapterName || 'unknown';
  const timeoutMs = options.timeoutMs;

  const rows = [];
  const caseCache = new Map();

  for (const item of items) {
    const sub = submissions.get(safeName(item.id)) || submissions.get(item.id);
    if (!sub) {
      rows.push({ id: item.id, status: 'unanswered' });
      continue;
    }
    const list = Array.isArray(sub.assertions) ? sub.assertions : [];
    if (list.length === 0) {
      rows.push({ id: item.id, status: 'empty', detail: 'submission.assertions 是空数组' });
      continue;
    }
    const errs = validateAssertions(list, 'submitted');
    if (errs.length > 0) {
      rows.push({ id: item.id, status: 'invalid', detail: errs[0] });
      continue;
    }

    let c = caseCache.get(item.case_file);
    if (!c) {
      c = await loadCase(item.case_file);
      caseCache.set(item.case_file, c);
    }
    const m = MUTATIONS.find(function (x) { return x.id === item.mutant; });
    if (!m) {
      rows.push({ id: item.id, status: 'unknown_mutant', detail: item.mutant });
      continue;
    }

    const relit = withAssertions(c, list);
    const good = await probe(relit, await adapterFactory(), { adapterName, timeoutMs });
    const bad = await probe(relit, m.wrap(await adapterFactory()), { adapterName, timeoutMs });

    const cells = list.map(function (_, i) {
      const g = good.results[i];
      const b = bad.results[i];
      if (!g || g.status !== 'true') return 'unarmed';
      if (!b) return 'blind';
      if (b.status === 'false') return 'killed';
      if (b.status === 'unknown') return 'blind';
      return 'survived';
    });
    const killed = cells.filter(function (x) { return x === 'killed'; }).length;
    const unarmed = cells.filter(function (x) { return x === 'unarmed'; }).length;
    let detail = null;
    if (killed === 0) {
      detail = unarmed === list.length
        ? '全部断言在正确实现上就不成立 —— 这不是抓故障，是乱写'
        : '断言在正确实现上成立，在这份坏实现上也成立 —— 它看不见这个故障';
    }
    rows.push({
      id: item.id,
      status: killed > 0 ? 'solved' : 'missed',
      submitted: list.length,
      killed: killed,
      unarmed: unarmed,
      cells: cells,
      detail: detail,
    });
  }

  function count(status) {
    return rows.filter(function (r) { return r.status === status; }).length;
  }
  const graded = count('solved') + count('missed');
  const ungraded = count('unanswered') + count('empty') + count('invalid') + count('unknown_mutant');

  return {
    drill_version: DRILL_VERSION,
    summary: {
      items: items.length,
      solved: count('solved'),
      missed: count('missed'),
      unanswered: count('unanswered'),
      empty: count('empty'),
      invalid: count('invalid'),
      unknown_mutant: count('unknown_mutant'),
      graded: graded,
      ungraded: ungraded,
      rate: graded === 0 ? null : count('solved') / graded,
    },
    rows: rows,
  };
}

export function formatGrade(report, opts) {
  const detail = Boolean(opts && opts.detail);
  const s = report.summary;
  const out = [];
  out.push('批改结果 · ' + s.items + ' 题');
  out.push('');
  out.push(
    '  解出 ' + s.solved + ' / 可批改 ' + s.graded + '   → ' +
      (s.rate === null ? '—（分母为 0）' : (s.rate * 100).toFixed(1) + '%'),
  );
  if (s.missed > 0) out.push('  没抓到 ' + s.missed + ' 题');
  if (s.ungraded > 0) {
    const parts = [];
    if (s.unanswered > 0) parts.push('未作答 ' + s.unanswered);
    if (s.empty > 0) parts.push('空提交 ' + s.empty);
    if (s.invalid > 0) parts.push('格式不对 ' + s.invalid);
    if (s.unknown_mutant > 0) parts.push('变异体不认识 ' + s.unknown_mutant);
    out.push('  批改不了 ' + s.ungraded + ' 题（' + parts.join('、') + '）');
  }
  const show = detail ? report.rows : report.rows.filter(function (r) { return r.status !== 'unanswered'; });
  if (show.length > 0) {
    out.push('');
    const marks = { solved: '解出', missed: '没抓到', unanswered: '未答', empty: '空', invalid: '格式', unknown_mutant: '变异体' };
    show.forEach(function (r) {
      const line = '  ' + (marks[r.status] || r.status) + '  ' + r.id;
      out.push(r.detail ? line + '\n        ' + r.detail : line);
    });
  }
  return out.join('\n');
}

/** 没给 --min 时：必须全解出，且没有批改不了的题。 */
export function gradeExit(report, opts) {
  const min = opts && opts.min !== undefined && opts.min !== null ? opts.min : null;
  const s = report.summary;
  if (min !== null) {
    if (s.rate === null) return 1;
    return s.rate + 1e-9 >= min ? 0 : 1;
  }
  // 默认要求答满：漏一题就不算过。示例提交只覆盖了一部分题（建议断言只能表达集合内的
  // 字段差异，整实体替换与集合外差异需要人写），CI 用 --allow-missed 校验「答了就必须对」。
  if (opts && opts.allowMissed === true) {
    // 没答的照实报，但答错的、交上来却没法批的仍然算失败。
    return s.missed === 0 && s.invalid === 0 && s.empty === 0 && s.unknown_mutant === 0 ? 0 : 1;
  }
  return s.missed === 0 && s.ungraded === 0 ? 0 : 1;
}

export async function writeDrills(dir, report) {
  await mkdir(dir, { recursive: true });
  const index = {
    drill_version: report.drill_version,
    adapter: report.adapter,
    generated: report.generated,
    items: [],
  };
  for (const item of report.items) {
    const base = safeName(item.id);
    await writeFile(join(dir, base + '.json'), JSON.stringify(item, null, 2) + '\n', 'utf8');
    await writeFile(join(dir, base + '.task.md'), taskSheet(item), 'utf8');
    index.items.push({ id: item.id, file: base + '.json', sheet: base + '.task.md' });
  }
  await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}

export async function readDrills(dir) {
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  const items = [];
  for (const row of index.items) {
    items.push(JSON.parse(await readFile(join(dir, row.file), 'utf8')));
  }
  return { index: index, items: items };
}

export async function readSubmissions(dir) {
  const out = new Map();
  let names = [];
  try {
    names = await readdir(dir);
  } catch (err) {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const key = name.slice(0, -5);
    try {
      out.set(key, JSON.parse(await readFile(join(dir, name), 'utf8')));
    } catch (err) {
      out.set(key, { assertions: [], __error: String(err && err.message) });
    }
  }
  return out;
}

/**
 * record —— 把 Agent 的实际动作还原成候选轨迹
 *
 * judge 已经能判任意轨迹，但轨迹此前只能手写。这一层补上最后一公里：
 * 吃一份动作日志（Agent 自己发的 HTTP 请求，或运行时导出的结构化动作），
 * 产出 verify --trajectory 能直接吃的文件。
 *
 * 设计取舍：
 * - 只认两种输入。HTTP 请求（能证明真的跑过）与结构化动作（运行时最省事）。
 *   不去猜日志格式，猜错一次就是一条安静的假轨迹。
 * - 反查能力靠 manifest 里的 http 模板，反查参数靠适配器的 toStep。
 *   为什么放在适配器里：dishList → items 这种映射属于实现知识，核心不该知道。
 * - 绑定是自动推的：某一步的参数值等于前面某步返回的实体 id，就写成 $sN.orderId。
 *   不这么做，录下来的 id 只在那一次环境里成立，换个沙箱就全错。
 * - 默认只录写操作。读操作是 Agent 用来摸 id 的，不是被判的动作；
 *   混进来还会撞 allowed_capabilities，把好轨迹判成 invalid_action。
 */

const WRITE_KIND = 'write';

function asArray(x) {
  return Array.isArray(x) ? x : [];
}

export function parseLog(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  return trimmed
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

function segments(p) {
  return String(p ?? '').split('?')[0].split('/').filter((s) => s !== '');
}

// 'POST /kitchen/order/{id}/accept' + 'POST' + '/kitchen/order/7/accept'
export function matchHttp(manifest, method, requestPath) {
  const want = segments(requestPath);
  for (const cap of asArray(manifest?.capabilities)) {
    if (typeof cap.http !== 'string') continue;
    const sp = cap.http.indexOf(' ');
    if (sp < 0) continue;
    const m = cap.http.slice(0, sp).toUpperCase();
    if (m !== String(method).toUpperCase()) continue;
    const tpl = segments(cap.http.slice(sp + 1));
    if (tpl.length !== want.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < tpl.length; i += 1) {
      const t = tpl[i];
      if (t.startsWith('{') && t.endsWith('}')) params[t.slice(1, -1)] = want[i];
      else if (t !== want[i]) { ok = false; break; }
    }
    if (ok) return { capability: cap.id, kind: cap.kind, params };
  }
  return null;
}

// 业务码 → 结局。200 是这门语言里唯一的成功；4xxxx 是被业务拒绝；
// 其余（连不上、令牌失效、5xxxx）不是这条轨迹的属性，跳过而不是记成 rejected。
export function outcomeOf(entry) {
  const code = entry?.response?.code;
  const status = Number(entry?.status ?? 0);
  if (typeof code === 'number') {
    if (code === 200) return 'applied';
    // 401xx = 没通过身份认证。这是"跑这段日志的人自己的凭证出了问题"，
    // 不是 Agent 的动作被业务拒绝，记成 rejected 会把环境故障算成 Agent 的错。
    if (code >= 40100 && code < 40200) return null;
    if (code >= 40000 && code < 50000) return 'rejected';
    return null;
  }
  if (status === 200) return 'applied';
  if (status >= 400 && status < 500) return 'rejected';
  return null;
}

function collectObserved(entry) {
  const out = {};
  const data = entry?.response?.data;
  const direct = entry?.observed;
  if (direct && typeof direct === 'object') Object.assign(out, direct);
  if (data && typeof data === 'object') {
    if (data.id !== undefined) out.orderId = data.id;
    if (data.orderId !== undefined) out.orderId = data.orderId;
    if (data.status !== undefined) out.status = data.status;
  }
  return out;
}

// 把参数里等于"已知实体 id"的值换成绑定表达式
function bindify(args, knownIds, path = '') {
  const out = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v && typeof v === 'object') {
      out[k] = Array.isArray(v) ? v.map((x, i) => bindify({ x }, knownIds, path).x ?? x) : bindify(v, knownIds);
      continue;
    }
    const hit = knownIds.get(String(v));
    if (hit) out[k] = `$${hit}.orderId`;
    else out[k] = v;
  }
  return out;
}

/**
 * entries → steps
 * @param {object} opts { manifest, adapter, includeReads }
 */
export function inferSteps({ entries, manifest, adapter, includeReads = false }) {
  const steps = [];
  const skipped = [];
  const knownIds = new Map(); // 实体 id 字符串 → 产出它的 step id
  let n = 0;

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i] ?? {};
    let capability = e.capability;
    let matched = null;

    if (capability === undefined) {
      const where = e.method && e.path ? { method: e.method, path: e.path } : null;
      if (!where) { skipped.push({ index: i, reason: 'not_a_request', detail: '既没有 capability 也没有 method/path' }); continue; }
      matched = matchHttp(manifest, e.method, e.path);
      if (!matched) { skipped.push({ index: i, reason: 'unmapped_request', detail: `${e.method} ${e.path} 不在 manifest 的 http 模板里` }); continue; }
      capability = matched.capability;
    }

    const kind = matched?.kind ?? asArray(manifest?.capabilities).find((c) => c.id === capability)?.kind;
    if (!includeReads && kind !== WRITE_KIND) { skipped.push({ index: i, reason: 'read_skipped', detail: `${capability} 是读操作，默认不录` }); continue; }

    const outcome = e.outcome ?? outcomeOf(e);
    if (outcome === null) { skipped.push({ index: i, reason: 'no_outcome', detail: `${capability} 的响应既不是成功也不是业务拒绝` }); continue; }

    if (typeof e.as !== 'string' || e.as === '') { skipped.push({ index: i, reason: 'missing_as', detail: `${capability} 没有记录执行者角色` }); continue; }

    const args = e.arguments !== undefined
      ? e.arguments
      : typeof adapter?.toStep === 'function'
        ? adapter.toStep(e, matched ?? { capability, params: {} })
        : { ...(matched?.params ?? {}) };
    if (args === null) { skipped.push({ index: i, reason: 'unparsable_arguments', detail: `${capability} 的参数无法还原` }); continue; }

    n += 1;
    const id = `s${n}`;
    const bound = bindify(args, knownIds);
    const step = { id, capability, as: e.as, expected_outcome: outcome };

    // 纯字面量就写 arguments，含绑定就写 bindings，两者不混
    const hasBinding = JSON.stringify(bound).includes('"$s');
    if (hasBinding) {
      step.bindings = bound;
      // 未绑定的常量也要带上，否则适配器拿不到必填参数
      const literal = {};
      for (const [k, v] of Object.entries(bound)) {
        if (typeof v !== 'string' || !v.startsWith('$s')) literal[k] = v;
      }
      if (Object.keys(literal).length > 0) step.arguments = literal;
    } else {
      step.arguments = bound;
    }
    steps.push(step);

    const observed = collectObserved(e);
    // 只认第一个产出者。accept/ready 的响应里也会回显同一个 orderId，
    // 若每次回显都改写，绑定会串成 $s2 → $s3 这种传递链，读起来像另一回事。
    if (observed.orderId !== undefined && !knownIds.has(String(observed.orderId))) {
      knownIds.set(String(observed.orderId), id);
    }
  }

  return { steps, skipped };
}

export function toTrajectoryDoc({ steps, skipped, producedBy, caseId }) {
  const doc = {
    note: caseId ? `由 record 从 ${producedBy} 还原，对应案例 ${caseId}` : `由 record 从 ${producedBy} 还原`,
    produced_by: producedBy,
    trajectory: steps,
  };
  if (skipped && skipped.length > 0) doc.skipped = skipped;
  return doc;
}

export function recordTrajectory({ text, manifest, adapter, producedBy = 'unknown', includeReads = false }) {
  const entries = parseLog(text);
  const { steps, skipped } = inferSteps({ entries, manifest, adapter, includeReads });
  const doc = toTrajectoryDoc({ steps, skipped, producedBy });
  return { entryCount: entries.length, doc };
}

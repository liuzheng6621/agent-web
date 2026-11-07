// 第六个域：研启・SciAegis（实验室「预约 — 审批 — 门禁凭证 — 器材借用」）。
//
// 为什么挑它：前五个域里没有一个是「带时间窗与容量约束的审批流」。
// 这里的状态不是靠写接口改的，是被时间推着走的：预约有时段、时段有容量、
// 批准之后才发得出凭证、凭证有效期又被预约结束时间截断。
// 三条断言只有在这个形状上才用得上：`state_machine`（预约/借用两条状态机）、
// `timeliness`（凭证有效期必须落在时段内）、`relation`（可借数量 = 总量 − 借出）。

const DEFAULTS = {
  baseUrl: process.env.LABACCESS_BASE_URL || 'http://127.0.0.1:8182',
  studentPassword: 'Aw#student123',
  teacherPassword: 'Aw#teacher123',
  adminUsername: process.env.LABACCESS_ADMIN_USER || 'admin',
};

// 管理员密码只从本机 .env 读，不写死进仓库。
function adminPassword() {
  const fromEnv = process.env.LABACCESS_ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  throw new Error('缺少 LABACCESS_ADMIN_PASSWORD：从 appointment-check-in-system/services/backend/.env 注入');
}

const OFFSET = '+08:00';
const pad = (n) => String(n).padStart(2, '0');

/** 本机时区下的 'YYYY-MM-DDTHH:mm:ss+08:00'。这个后端收 OffsetDateTime，不带偏移会报「不是合法 JSON」。 */
function stamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T`
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${OFFSET}`;
}

function addMinutes(base, minutes) {
  return stamp(new Date(base.getTime() + minutes * 60_000));
}

export function createLabAccessAdapter(options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const base = String(opt.baseUrl).replace(/\/+$/, '');
  let runId = null;
  let ctx = null;

  async function http(method, path, { body, token } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json };
  }

  /** 这个后端所有响应都是 {success, data, error:{code,message}}，异常一律走 success=false。 */
  function unwrap(r) {
    if (r.json && r.json.success === true) return r.json.data;
    const err = r.json?.error;
    const e = new Error(err?.message || `HTTP ${r.status}`);
    e.code = err?.code || `http_${r.status}`;
    e.status = r.status;
    throw e;
  }

  async function loginAdmin() {
    return unwrap(await http('POST', '/api/v1/auth/admin/login',
      { body: { username: opt.adminUsername, password: adminPassword() } })).token;
  }

  async function loginAs(account, password, appType) {
    return unwrap(await http('POST', '/api/v1/auth/password/login',
      { body: { account, password, appType } })).token;
  }

  /** 新建身份的密码是管理员设的，首登被强制改密；改完要重新登录才拿到不带该标记的 token。 */
  async function activate(account, initial, final, appType) {
    const first = await loginAs(account, initial, appType);
    unwrap(await http('POST', '/api/v1/account/password',
      { token: first, body: { currentPassword: initial, newPassword: final } }));
    return loginAs(account, final, appType);
  }

  const CAPS = [
    { id: 'labs.list', kind: 'read', summary: '实验室列表（本轮的实验室）', evidence_level: 'observed' },
    { id: 'reservations.list', kind: 'read', summary: '本轮实验室的预约', evidence_level: 'observed' },
    { id: 'equipment.list', kind: 'read', summary: '本轮实验室的器材', evidence_level: 'observed' },
    { id: 'reservations.create', kind: 'write', summary: '学生提交预约', roles: ['student'], evidence_level: 'observed' },
    { id: 'reservations.cancel', kind: 'write', summary: '学生取消预约', roles: ['student'], evidence_level: 'observed' },
    { id: 'reservations.approve', kind: 'write', summary: '教师批准预约', roles: ['teacher'], evidence_level: 'observed' },
    { id: 'reservations.reject', kind: 'write', summary: '教师驳回预约', roles: ['teacher'], evidence_level: 'observed' },
    { id: 'access.otp', kind: 'write', summary: '学生取一次性门禁口令', roles: ['student'], evidence_level: 'observed' },
    { id: 'borrow.create', kind: 'write', summary: '学生申请借用器材', roles: ['student'], evidence_level: 'observed' },
    { id: 'borrow.approve', kind: 'write', summary: '教师批准借用（扣可借数量）', roles: ['teacher'], evidence_level: 'observed' },
    { id: 'borrow.return', kind: 'write', summary: '教师确认归还（恢复可借数量）', roles: ['teacher'], evidence_level: 'observed' },
  ];

  return {
    async manifest() {
      return {
        adapter: 'labaccess',
        adapter_version: '1',
        baseUrl: base,
        reset_strategy: 'identity',
  clock_policies: ['wall'],   // 真实后端，时间戳由服务端生成，冻不住
        // 这后端只有审计日志，没有「实体事件流」；写 false 就不会有人拿事件断言去查它。
        events_complete: false,
        roles: ['admin', 'teacher', 'student'],
        scopes: ['labs', 'reservations', 'equipment', 'borrows'],
        capabilities: CAPS,
      };
    },

    async reset() {
      runId = `aw${Date.now().toString(36)}`;
      const admin = await loginAdmin();
      const hours = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, openTime: '00:00', closeTime: '23:59', enabled: true }));

      const lab = unwrap(await http('POST', '/api/v1/admin/labs', {
        token: admin,
        body: { name: `aw-lab-${runId}`, location: '自动化', capacity: 2, openingHours: hours },
      }));
      const labId = Number(lab.labId);

      const teacher = `awt${runId}`;
      const student = `aws${runId}`;
      const student2 = `aws2${runId}`;
      unwrap(await http('POST', '/api/v1/admin/teachers', {
        token: admin,
        body: { name: teacher, staffId: teacher, password: opt.teacherPassword, managedLabIds: [labId] },
      }));
      for (const s of [student, student2]) {
        unwrap(await http('POST', '/api/v1/admin/students', {
          token: admin, body: { name: s, studentId: s, password: opt.studentPassword },
        }));
      }

      const equipment = unwrap(await http('POST', '/api/v1/admin/equipment', {
        token: admin,
        body: { equipmentCode: `awq${runId}`, laboratoryId: labId, name: `aw-rig-${runId}`, totalQuantity: 5 },
      }));

      const teacherToken = await activate(teacher, opt.teacherPassword, `${opt.teacherPassword}x`, 'teacher');
      const studentToken = await activate(student, opt.studentPassword, `${opt.studentPassword}x`, 'student');
      const student2Token = await activate(student2, opt.studentPassword, `${opt.studentPassword}x`, 'student');

      ctx = {
        admin, teacherToken, studentToken, student2Token, labId,
        equipmentId: Number(equipment.equipmentId ?? equipment.id),
        teacher, student, student2,
      };

      const state = await observeState();
      return {
        runId,
        state,
        roleBindings: { admin: opt.adminUsername, teacher, student, student2 },
        reset_note: `新建实验室 ${labId}、器材 ${ctx.equipmentId}、两个学生一个教师`,
      };
    },

    async observe() {
      const state = await observeState();
      return { state, missingScopes: [] };
    },

    async execute(_runId, action) {
      // 契约是 execute(runId, { capability, arguments, as })：能力在 action 里，不是第一个参数。
      const id = action?.capability;
      const a = action?.arguments ?? {};
      // 身份必须跟着步骤走：案例里写 `as: student` 然后用教师 token 去打，
      // 就是「身份塌缩」——越权案例会假通过，而它恰恰是这个域最该验的一条。
      return dispatch(id, a, action?.as ?? null);
    },

    async close() {
      // 没有需要释放的资源：这后端不提供复位接口，本轮新建的行留在库里，靠 runId 前缀区分。
    },
  };

  // 视图里**不许出现本轮专属的值**（labId、编号、账号名、绝对时间）：
  // reset 每轮都会新建一批行，这些值一轮一个样，写进视图就等于「每次复位初态都不同」，
  // 复位幂等与无状态泄漏两项探针必然报红。要判的东西（状态、数量、容量）本来就与身份无关。
  async function observeState() {
    const admin = ctx?.admin;
    const labId = ctx?.labId;
    const labs = unwrap(await http('GET', '/api/v1/admin/labs', { token: admin })).items ?? [];
    const mine = labs.filter((l) => Number(l.labId) === labId)
      .map((l) => ({ capacity: l.capacity, status: l.status }));
    const res = unwrap(await http('GET', '/api/v1/admin/reservations?page=1&pageSize=100', { token: admin })).items ?? [];
    const reservations = res.filter((r) => Number(r.labId) === labId)
      .map((r) => ({ status: r.status, purpose: r.purpose ?? null }));
    const eqs = unwrap(await http('GET', '/api/v1/admin/equipment', { token: admin })).items ?? [];
    const equipment = eqs.filter((e) => Number(e.labId) === labId)
      .map((e) => ({ totalQuantity: e.totalQuantity, availableQuantity: e.availableQuantity }));
    const brs = unwrap(await http('GET', '/api/v1/admin/borrow-requests?page=1&pageSize=100', { token: admin })).items ?? [];
    const borrows = brs.filter((b) => Number(b.equipmentId) === ctx?.equipmentId)
      .map((b) => ({ status: b.status, quantity: b.quantity }));
    // 顺序稳定：按 status 再按数量排，免得后端返回顺序一变初态哈希就变。
    const key = (o) => JSON.stringify(o);
    return {
      labs: mine.sort((x, y) => key(x).localeCompare(key(y))),
      reservations: reservations.sort((x, y) => key(x).localeCompare(key(y))),
      equipment: equipment.sort((x, y) => key(x).localeCompare(key(y))),
      borrows: borrows.sort((x, y) => key(x).localeCompare(key(y))),
    };
  }

  async function dispatch(id, a, as = null) {
    const now = new Date();
    try {
      switch (id) {
        case 'labs.list':
          return applied((await observeState()).labs);
        case 'reservations.list':
          return applied((await observeState()).reservations);
        case 'equipment.list':
          return applied((await observeState()).equipment);
        case 'reservations.create': {
          const startsIn = Number(a.startsInMinutes ?? 120);
          const startAt = a.startAt ?? addMinutes(now, startsIn);
          const endAt = a.endAt ?? addMinutes(now, startsIn + Number(a.durationMinutes ?? 30));
          const token = tokenFor(as === 'student2' ? 'student2' : (a.asStudent2 ? 'student2' : 'student'));
          const data = unwrap(await http('POST', '/api/v1/student/reservations', {
            token, body: { laboratoryId: ctx.labId, startAt, endAt, purpose: a.purpose ?? 'agent-web' },
          }));
          return applied({ reservationId: Number(data.reservationId), status: data.status, startAt, endAt });
        }
        case 'reservations.approve':
        case 'reservations.reject': {
          const verb = id === 'reservations.approve' ? 'approve' : 'reject';
          unwrap(await http('POST', `/api/v1/teacher/approvals/${a.reservationId}/${verb}`,
            { token: tokenFor(as), body: { note: a.note ?? 'ok' } }));
          return applied({ reservationId: Number(a.reservationId) });
        }
        case 'reservations.cancel': {
          unwrap(await http('POST', `/api/v1/student/reservations/${a.reservationId}/cancel`,
            { token: tokenFor(as), body: {} }));
          return applied({ reservationId: Number(a.reservationId) });
        }
        case 'access.otp': {
          const data = unwrap(await http('POST',
            `/api/v1/student/reservations/${a.reservationId}/access/otp`, { token: tokenFor(as), body: {} }));
          // 口令本身不该进判决（每次都变）：只回可判的三样——作用域、起始、到期。
          return applied({
            scope: data.scope, validFrom: data.validFrom ?? data.issuedAt ?? null,
            expiresAt: data.expiresAt, reservationId: Number(data.reservationId ?? a.reservationId),
          });
        }
        case 'borrow.create': {
          const startAt = a.borrowStartAt ?? addMinutes(now, 60);
          const endAt = a.borrowEndAt ?? addMinutes(now, 120);
          const data = unwrap(await http('POST', '/api/v1/student/borrow-requests', {
            token: ctx.studentToken,
            body: {
              equipmentId: ctx.equipmentId, quantity: Number(a.quantity ?? 2), purpose: 'agent-web',
              borrowStartAt: startAt, borrowEndAt: endAt,
            },
          }));
          return applied({ requestId: Number(data.requestId ?? data.borrowRequestId), quantity: Number(a.quantity ?? 2) });
        }
        case 'borrow.approve':
        case 'borrow.return': {
          const verb = id === 'borrow.approve' ? 'approve' : 'return';
          unwrap(await http('POST', `/api/v1/teacher/borrow-requests/${a.requestId}/${verb}`,
            { token: tokenFor(as), body: { note: 'agent-web' } }));
          return applied({ requestId: Number(a.requestId) });
        }
        default:
          return { outcome: 'unsupported', payload: null, error: { code: 'not_declared', message: `能力 ${id} 没有实现` } };
      }
    } catch (e) {
      return { outcome: 'rejected', payload: null, error: { code: e.code || 'http_error', message: e.message } };
    }
  }

  /** 把案例里的角色名换成这个域里真正的那张票。 */
  function tokenFor(role) {
    if (!role) return ctx.studentToken;
    if (role === 'teacher' || role === 'admin') return ctx.teacherToken;
    if (role === 'student' || role === 'student2') return role === 'student2' ? ctx.student2Token : ctx.studentToken;
    return ctx.studentToken;
  }

  function applied(payload) {
    return { outcome: 'applied', payload };
  }
}

export const createAdapter = createLabAccessAdapter;

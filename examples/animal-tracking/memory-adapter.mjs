import { validateManifest } from '../../src/adapter/contract.mjs';

const MANIFEST = {
  adapter: 'animal-tracking-memory',
  adapter_version: '1.0.0',
  reset_strategy: 'snapshot',
  description: '流浪动物救助任务的确定性离线夹具：审核、接取、执行者校验与积分奖励',
  scopes: ['tasks', 'points'],
  roles: ['reporter', 'admin', 'volunteer', 'otherVolunteer'],
  view: {
    version: 'agent-web/view/1',
    collections: {
      tasks: {
        kind: 'list',
        required: ['id', 'status', 'isApproved', 'assignedToRole', 'currentVolunteers', 'rewardPoints'],
        semantics: '本次隔离运行创建的救助任务',
      },
      points: {
        kind: 'list',
        required: ['role', 'points'],
        semantics: '本次运行志愿者的积分余额',
      },
    },
  },
  capabilities: [
    { id: 'task.create', kind: 'write', evidence_level: 'validated', roles: ['reporter'] },
    { id: 'task.approve', kind: 'write', evidence_level: 'validated', roles: ['admin'] },
    { id: 'task.accept', kind: 'write', evidence_level: 'validated', roles: ['volunteer'] },
    { id: 'task.complete', kind: 'write', evidence_level: 'validated', roles: ['volunteer', 'otherVolunteer'] },
  ],
};

const clone = (value) => structuredClone(value);

export function createAnimalMemoryAdapter() {
  const runs = new Map();
  let serial = 0;

  async function manifest() {
    return clone(MANIFEST);
  }

  async function reset() {
    serial += 1;
    const runId = `animal-memory-${serial}`;
    runs.set(runId, {
      task: null,
      nextId: serial,
      points: 0,
      roles: {
        reporter: `reporter-${serial}`,
        admin: `admin-${serial}`,
        volunteer: `volunteer-${serial}`,
        otherVolunteer: `other-volunteer-${serial}`,
      },
    });
    return {
      runId,
      state: { tasks: [], points: [{ role: 'volunteer', points: 0 }] },
      roleBindings: { ...runs.get(runId).roles },
    };
  }

  async function observe(runId) {
    const run = runs.get(runId);
    if (!run) return { state: null, missingScopes: MANIFEST.scopes };
    return {
      state: {
        tasks: run.task ? [clone(run.task)] : [],
        points: [{ role: 'volunteer', points: run.points }],
      },
      missingScopes: [],
    };
  }

  async function execute(runId, action) {
    const run = runs.get(runId);
    if (!run) return { outcome: 'infra_error', error: { code: 'no_run', message: 'run not found' } };
    const role = action.as;
    const cap = MANIFEST.capabilities.find((item) => item.id === action.capability);
    if (!cap) return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
    if (!cap.roles.includes(role)) {
      return { outcome: 'rejected', error: { code: 'forbidden', message: `${role} cannot ${action.capability}` } };
    }
    const args = action.arguments ?? {};
    const reject = (code, message) => ({ outcome: 'rejected', error: { code, message } });

    if (action.capability === 'task.create') {
      if (run.task) return reject('duplicate_task', 'only one task is allowed in this isolated case');
      run.task = {
        id: run.nextId,
        title: args.title,
        status: 'PENDING',
        isApproved: false,
        assignedToRole: null,
        currentVolunteers: 0,
        rewardPoints: Number(args.rewardPoints ?? 0),
      };
      return { outcome: 'applied', identity: run.roles[role], payload: { taskId: run.task.id, status: run.task.status } };
    }

    if (!run.task || String(args.taskId) !== String(run.task.id)) return reject('not_found', 'task not found');

    if (action.capability === 'task.approve') {
      if (run.task.status !== 'PENDING') return reject('invalid_status', 'task is not pending approval');
      run.task.isApproved = true;
      run.task.status = 'AVAILABLE';
      return { outcome: 'applied', identity: run.roles[role], payload: { taskId: run.task.id, status: run.task.status } };
    }

    if (action.capability === 'task.accept') {
      if (!run.task.isApproved) return reject('not_approved', 'task has not been approved');
      if (run.task.status !== 'AVAILABLE') return reject('invalid_status', 'task is not available');
      run.task.assignedToRole = role;
      run.task.currentVolunteers = 1;
      run.task.status = 'IN_PROGRESS';
      return { outcome: 'applied', identity: run.roles[role], payload: { taskId: run.task.id, status: run.task.status } };
    }

    if (action.capability === 'task.complete') {
      if (run.task.assignedToRole !== role) return reject('not_assignee', 'only the assigned volunteer can complete this task');
      if (run.task.status !== 'IN_PROGRESS') return reject('invalid_status', 'task is not in progress');
      run.task.status = 'COMPLETED';
      run.points += run.task.rewardPoints;
      return { outcome: 'applied', identity: run.roles[role], payload: { taskId: run.task.id, status: run.task.status } };
    }

    return { outcome: 'unsupported', error: { code: 'unsupported_capability', message: action.capability } };
  }

  async function close(runId) {
    runs.delete(runId);
  }

  return { manifest, reset, observe, execute, close };
}

export function createAdapter(options = {}) {
  return createAnimalMemoryAdapter(options);
}

export function validateAnimalMemoryAdapter() {
  return validateManifest(MANIFEST);
}

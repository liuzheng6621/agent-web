/**
 * 适配器加载器。
 *
 * 一个测试框架如果只认自己内置的两个适配器，它就只是一个 demo。
 * 接入成本必须压到「写一个文件、命令行指过去」这个量级，
 * 否则没人会把自己公司的系统接进来，仓库也就停在作者自己的机器上。
 *
 * 支持三种写法：
 *   memory                              内置名
 *   ./my-adapter.mjs                    文件路径（相对当前工作目录）
 *   @acme/agent-web-adapter-order       包名
 *
 * 模块导出解析顺序：
 *   1. createAdapter(options)           首选，工厂函数
 *   2. default 是函数                    当作工厂
 *   3. default 是对象                    当作适配器实例
 *   4. 模块自身有 manifest/reset/observe/execute  直接当实例
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateAdapter } from './contract.mjs';

const BUILTINS = {
  // 示例域：账本（两个独立实现，用来验证案例可移植性）
  'ledger-a': async () => {
    const m = await import('../../examples/ledger/adapter-a.mjs');
    return m.createAdapter();
  },
  'ledger-b': async () => {
    const m = await import('../../examples/ledger/adapter-b.mjs');
    return m.createAdapter();
  },
  memory: async () => {
    const m = await import('./memory.mjs');
    return m.createMemoryAdapter();
  },
  // 词库域：900 条合成词条，用来验分页/排序/唯一性在大结果集上的行为。
  // 两个实现的内部结构不同（字典树 vs 二分区间，贪心 vs 反向 DP），必须判决一致。
  'lexicon-a': async () => {
    const m = await import('../../examples/lexicon/adapter-a.mjs');
    return m.createLexiconA();
  },
  'lexicon-b': async () => {
    const m = await import('../../examples/lexicon/adapter-b.mjs');
    return m.createLexiconB();
  },
  taixianglian: async () => {
    const m = await import('./taixianglian.mjs');
    return m.createTaixianglianAdapter();
  },
  // 第三个域的真实后端（Spring Boot 3 + MySQL）：形状与咖啡店完全不同 ——
  // Spring Page 信封、大写状态、三角色、审批链。它自己的缺陷也写成了案例。
  animal: async () => {
    const m = await import('./animal.mjs');
    return m.createAnimalAdapter();
  },
  // RealWorld 契约：19 个端点、一份案例可以在 990+ 个实现上重跑。
  // 地址取 REALWORLD_BASE_URL（默认 http://127.0.0.1:8299）。
  // 配套的零依赖仿真服务在 examples/realworld/fake-server.mjs。
  realworld: async () => {
    const m = await import('./realworld.mjs');
    return m.createRealWorldAdapter();
  },
  // 同一份契约的**第二个实现**：地址取 REALWORLD_B_BASE_URL（默认 8298），
  // 配套服务在 examples/realworld/fake-server-b.mjs。
  // 它存在的唯一目的是让 `compare --adapters=realworld,realworld-b` 有意义 ——
  // 两个适配器打两份独立实现，判决必须一致；只换适配器不换实现是自证。
  // 第六个域的真实后端：实验室「预约 — 审批 — 限时门禁凭证 — 器材借用」。
  // 它带来前五个域都没有的形状：**时间推着状态走**（时段/容量/凭证有效期），
  // 所以 state_machine、timeliness、relation 三种断言在这里才有真对手。
  // 地址取 LABACCESS_BASE_URL（默认 http://127.0.0.1:8182），管理员密码取
  // LABACCESS_ADMIN_PASSWORD（从该项目 services/backend/.env 注入，不入库）。
  // 定时任务域：两个独立实现，专门逼出「节律」这一维——
  // 前六个域里时间是标量（有效期、时间窗），这里时间是槽位序列。
  'cron-a': async () => {
    const m = await import('../../examples/cron/adapter-a.mjs');
    return m.createAdapter();
  },
  'cron-b': async () => {
    const m = await import('../../examples/cron/adapter-b.mjs');
    return m.createAdapter();
  },
  labaccess: async () => {
    const m = await import('./labaccess.mjs');
    return m.createLabAccessAdapter();
  },
  'realworld-b': async () => {
    const m = await import('./realworld.mjs');
    return m.createRealWorldAdapter({
      baseUrl: process.env.REALWORLD_B_BASE_URL || 'http://127.0.0.1:8298',
    });
  },
};

export function listBuiltins() {
  return Object.keys(BUILTINS);
}

/** 判断一个字符串该被当成文件路径还是包名。 */
export function isPathSpec(spec) {
  // scoped 包名带斜杠，但不是路径。漏了这一条，@acme/xxx 会被当成文件去解析。
  if (spec.startsWith('@')) return false;
  return (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(spec) ||
    spec.includes('/') ||
    spec.includes('\\') ||
    /\.(mjs|cjs|js)$/.test(spec)
  );
}

function pickFactory(mod, spec) {
  if (typeof mod.createAdapter === 'function') return () => mod.createAdapter();
  if (typeof mod.default === 'function') return () => mod.default();
  if (mod.default && typeof mod.default === 'object') return () => mod.default;
  if (typeof mod.manifest === 'function' && typeof mod.execute === 'function') return () => mod;
  throw new Error(
    `模块 ${spec} 没有导出可用的适配器：需要 createAdapter() 函数、default 导出，或直接导出 manifest/reset/observe/execute`,
  );
}

/**
 * 按 spec 解析出适配器实例。
 * @param {string} spec 内置名 / 文件路径 / 包名
 * @param {object} options 传给工厂的参数
 * @param {string} cwd 解析相对路径的基准目录
 */
// 红线：适配器不是配置，是可执行的普通 Node 模块。import 的那一刻它就以当前
// 用户身份跑起来了——能读环境变量、读写文件、发网络请求。在跑别人的案例集之前，
// 先看一眼适配器文件里写了什么。这里只提醒，不拦：拦住了也拦不住真正想跑的人。
function warnExternal(spec, resolved) {
  if (process.env.AGENT_WEB_QUIET_ADAPTER_WARNING === '1') return;
  process.stderr.write(
    `注意：正在加载外部适配器 ${spec}
` +
      `      文件 ${resolved}
` +
      `      它会被当作普通 Node 模块 import，以当前用户权限执行任意代码
` +
      `      （可读环境变量、读写文件、访问网络）。只加载你信得过的东西。
` +
      `      确认了解可设 AGENT_WEB_QUIET_ADAPTER_WARNING=1 关掉这条提示。
`,
  );
}

export async function loadAdapter(spec, options = {}, cwd = process.cwd()) {
  const name = String(spec ?? '').trim();
  if (name === '') throw new Error('适配器名字为空');

  let factory;
  if (BUILTINS[name]) {
    factory = BUILTINS[name];
  } else if (isPathSpec(name)) {
    const abs = path.resolve(cwd, name);
    if (/\.(yml|yaml|json)$/i.test(abs)) {
      // 声明式规格与回放孪生都是数据，不是代码：不 import、不执行。
      // 这条路径没有「加载即执行」的代码面，是接新域时最安全的入口。
      if (/\.json$/i.test(abs)) {
        const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
        if (raw && Array.isArray(raw.steps) && raw.initial) {
          const { createTwinAdapter } = await import('./twin.mjs');
          factory = () => createTwinAdapter(raw, { name: raw.adapter || 'twin' });
        } else {
          const { loadDeclSpec, createAdapterFromSpec } = await import('./decl.mjs');
          const spec = loadDeclSpec(abs);
          spec.source = spec.source || abs;
          factory = () => createAdapterFromSpec(spec);
        }
      } else {
        const { loadDeclSpec, createAdapterFromSpec } = await import('./decl.mjs');
        const spec = loadDeclSpec(abs);
        spec.source = spec.source || abs;
        factory = () => createAdapterFromSpec(spec);
      }
    } else {
      warnExternal(name, abs);
      let mod;
      try {
        mod = await import(pathToFileURL(abs).href);
      } catch (e) {
        if (e && e.code === 'ERR_MODULE_NOT_FOUND') {
          throw new Error(`找不到适配器文件 ${abs}（相对路径按 ${cwd} 解析）`);
        }
        throw e;
      }
      factory = pickFactory(mod, name);
    }
  } else {
    warnExternal(name, name);
    let mod;
    try {
      mod = await import(name);
    } catch (e) {
      throw new Error(
        `未知适配器 ${name}：既不是内置名（${listBuiltins().join(', ')}），也加载不到同名包。` +
          `接自己的应用请写一个 .mjs 并用 --adapter=./path/to/adapter.mjs`,
      );
    }
    factory = pickFactory(mod, name);
  }

  const adapter = await factory(options);
  const errors = validateAdapter(adapter);
  if (errors.length > 0) {
    throw new Error(`适配器 ${name} 不符合契约：${errors.join('；')}`);
  }
  return adapter;
}

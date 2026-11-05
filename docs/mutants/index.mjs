/**
 * 变异体目录。这里不是 src —— 它是一份**需要被人审的清单**，
 * 而不是一段只要跑通就算数的代码。
 *
 * 投稿方式：复制任一文件改内容，把 id 写进下面的 ENTRIES，跑 npm test。
 */
import * as moneyOffByCent from './m-money-off-by-cent.mjs';
import * as statusFrozen from './m-status-frozen.mjs';
import * as historyEmpty from './m-history-empty.mjs';
import * as extraForeignOrder from './m-extra-foreign-order.mjs';
import * as foreignWriteAllowed from './m-foreign-write-allowed.mjs';
import * as noReject from './m-no-reject.mjs';
import * as payloadTruncate from './m-payload-truncate.mjs';
import * as itemCountFlattened from './m-item-count-flattened.mjs';
import * as pickupNoOffset from './m-pickup-no-offset.mjs';
import * as totalSingleUnit from './m-total-single-unit.mjs';
import * as subtotalStale from './m-subtotal-stale.mjs';
import * as cancelNoop from './m-cancel-noop.mjs';
import * as doubleCreate from './m-double-create.mjs';
import * as pageDuplicate from './m-page-duplicate.mjs';
import * as pageDrop from './m-page-drop.mjs';
import * as pageShuffle from './m-page-shuffle.mjs';
import * as duplicateRow from './m-duplicate-row.mjs';
import * as stringlyTotal from './m-stringly-total.mjs';
import * as statusOffEnum from './m-status-off-enum.mjs';
import * as unsortedOrders from './m-unsorted-orders.mjs';
import * as readWithSideEffect from './m-read-with-side-effect.mjs';
import * as skipIntermediate from './m-skip-intermediate.mjs';
import * as doubleEffect from './m-double-effect.mjs';
import * as ledgerSignFlip from './m-ledger-sign-flip.mjs';
import * as ledgerTotalLies from './m-ledger-total-lies.mjs';
import * as ledgerAnyBalance from './m-ledger-any-balance.mjs';
import * as transientMenuPrice from './m-transient-menu-price.mjs';
import * as midWriteLeak from './m-mid-write-leak.mjs';

const ENTRIES = [
  ['m-money-off-by-cent', moneyOffByCent],
  ['m-status-frozen', statusFrozen],
  ['m-history-empty', historyEmpty],
  ['m-extra-foreign-order', extraForeignOrder],
  ['m-foreign-write-allowed', foreignWriteAllowed],
  ['m-no-reject', noReject],
  ['m-payload-truncate', payloadTruncate],
  ['m-item-count-flattened', itemCountFlattened],
  ['m-pickup-no-offset', pickupNoOffset],
  ['m-total-single-unit', totalSingleUnit],
  ['m-subtotal-stale', subtotalStale],
  ['m-cancel-noop', cancelNoop],
  ['m-double-create', doubleCreate],
  ['m-duplicate-row', duplicateRow],
  ['m-stringly-total', stringlyTotal],
  ['m-status-off-enum', statusOffEnum],
  ['m-unsorted-orders', unsortedOrders],
  ['m-read-with-side-effect', readWithSideEffect],
  ['m-skip-intermediate', skipIntermediate],
  ['m-double-effect', doubleEffect],
  ['m-ledger-sign-flip', ledgerSignFlip],
  ['m-ledger-total-lies', ledgerTotalLies],
  ['m-ledger-any-balance', ledgerAnyBalance],
  ['m-transient-menu-price', transientMenuPrice],
  ['m-mid-write-leak', midWriteLeak],
  ['m-page-duplicate', pageDuplicate],
  ['m-page-drop', pageDrop],
  ['m-page-shuffle', pageShuffle],
];

const LAYERS = new Set(['state', 'execute']);
const REQUIRED = ['title', 'symptom', 'mechanism', 'catch_hint'];

export function validateMutants(list) {
  const errors = [];
  const seen = new Set();
  for (const [key, mod] of list) {
    const meta = mod?.meta;
    if (!meta) { errors.push(`${key}: 没有导出 meta`); continue; }
    if (meta.id !== key) errors.push(`${key}: meta.id 是 ${meta.id}，与登记名不符（复制粘贴没改？）`);
    if (seen.has(meta.id)) errors.push(`${meta.id}: id 重复`);
    seen.add(meta.id);
    if (!/^m-[a-z0-9]+(-[a-z0-9]+)*$/.test(String(meta.id))) errors.push(`${key}: id 应形如 m-some-thing`);
    if (!LAYERS.has(meta.layer)) errors.push(`${key}: layer 必须是 state 或 execute，实际 ${meta.layer}`);
    for (const f of REQUIRED) {
      if (typeof meta[f] !== 'string' || meta[f].trim() === '') errors.push(`${key}: 缺 ${f}`);
    }
    if (typeof mod.wrap !== 'function') errors.push(`${key}: 没有导出 wrap(adapter)`);
  }
  return errors;
}

const errors = validateMutants(ENTRIES);
if (errors.length > 0) {
  throw new Error('变异体目录不合法：\n' + errors.map((e) => '  - ' + e).join('\n'));
}

export const mutants = ENTRIES.map(([, mod]) => ({ ...mod.meta, wrap: mod.wrap }));
export const mutantIds = mutants.map((m) => m.id);
export function mutantById(id) {
  return mutants.find((m) => m.id === id) ?? null;
}

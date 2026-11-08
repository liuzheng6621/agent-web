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
import * as dropCreateEvent from './m-drop-create-event.mjs';
import * as duplicateEvent from './m-duplicate-event.mjs';
import * as shipmentLate from './m-shipment-late.mjs';
import * as illegalTransition from './m-illegal-transition-allowed.mjs';
import * as execRoleIgnore from './m-exec-role-ignore.mjs';
import * as execDuplicateWrite from './m-exec-duplicate-write.mjs';
import * as execDropIntermediate from './m-exec-drop-intermediate.mjs';
import * as dupCreditEntry from './m-dup-credit-entry.mjs';
import * as unbalancedAccepted from './m-unbalanced-accepted.mjs';
import * as approvalAutoapprove from './m-approval-autoapprove.mjs';

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
import * as lexiconPageDrop from './m-lexicon-page-drop.mjs';
import * as lexiconTotalLies from './m-lexicon-total-lies.mjs';
import * as lexiconDuplicateId from './m-lexicon-duplicate-id.mjs';
import * as lexiconStrokesAsText from './m-lexicon-strokes-as-text.mjs';
import * as lexiconUnsorted from './m-lexicon-unsorted.mjs';
import * as lexiconCategoryOutOfEnum from './m-lexicon-category-out-of-enum.mjs';
import * as lexiconSegmentTruncate from './m-lexicon-segment-truncate.mjs';
import * as lexiconLookupEmptyObject from './m-lexicon-lookup-empty-object.mjs';
import * as lexiconSegmentEcho from './m-lexicon-segment-echo.mjs';
import * as zeroTotal from './m-breed-zero-orders-0-totalamount.mjs';
import * as zeroItemCount from './m-breed-zero-orders-0-items-0-count.mjs';
import * as truncateStatus from './m-breed-truncate-orders-0-status.mjs';
import * as lowerStatus from './m-breed-lower-orders-0-status.mjs';
import * as nullMenu from './m-breed-null-fields-menu.mjs';
import * as dupFirstMenu from './m-breed-duplicate-first-menu.mjs';
import * as dropFirstMenu from './m-breed-drop-first-menu.mjs';
import * as blankLogType from './m-breed-blank-status-log-0-type.mjs';
import * as truncateLogType from './m-breed-truncate-status-log-0-type.mjs';
import * as labSlotConflictIgnore from './m-lab-slot-conflict-ignore.mjs';
import * as labOtpWindowIgnore from './m-lab-otp-window-ignore.mjs';
import * as labBorrowStockFrozen from './m-lab-borrow-stock-frozen.mjs';
import * as cronSkipSlot from './m-cron-skip-slot.mjs';
import * as cronDoubleFire from './m-cron-double-fire.mjs';
import * as cronDrift from './m-cron-drift.mjs';
import * as labApproveNotPending from './m-lab-approve-not-pending.mjs';
import * as sqlPhantomSuccess from './m-sql-phantom-success.mjs';
import * as sqlCrossUserLeak from './m-sql-cross-user-leak.mjs';
import * as sqlLogTypeFlip from './m-sql-log-type-flip.mjs';
import * as logOrderSwap from './m-log-order-swap.mjs';
import * as sqlTotalDrift from './m-sql-total-drift.mjs';
import * as unitPriceFlip from './m-unit-price-flip.mjs';

const ENTRIES = [
  ['m-money-off-by-cent', moneyOffByCent],
  ['m-status-frozen', statusFrozen],
  ['m-history-empty', historyEmpty],
  ['m-extra-foreign-order', extraForeignOrder],
  ['m-foreign-write-allowed', foreignWriteAllowed],
  ['m-no-reject', noReject],
  ['m-payload-truncate', payloadTruncate],
  ['m-drop-create-event', dropCreateEvent],
  ['m-duplicate-event', duplicateEvent],
  ['m-shipment-late', shipmentLate],
  ['m-illegal-transition-allowed', illegalTransition],
  ['m-exec-role-ignore', execRoleIgnore],
  ['m-exec-duplicate-write', execDuplicateWrite],
  ['m-exec-drop-intermediate', execDropIntermediate],
  ['m-dup-credit-entry', dupCreditEntry],
  ['m-unbalanced-accepted', unbalancedAccepted],
  ['m-approval-autoapprove', approvalAutoapprove],
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
  // 词库域：900 条合成词条，分页/唯一性/类型这三类断言在这里才真的有活干。
  ['m-lexicon-page-drop', lexiconPageDrop],
  ['m-lexicon-total-lies', lexiconTotalLies],
  ['m-lexicon-duplicate-id', lexiconDuplicateId],
  ['m-lexicon-strokes-as-text', lexiconStrokesAsText],
  ['m-lexicon-unsorted', lexiconUnsorted],
  ['m-lexicon-category-out-of-enum', lexiconCategoryOutOfEnum],
  ['m-lexicon-segment-truncate', lexiconSegmentTruncate],
  ['m-lexicon-lookup-empty-object', lexiconLookupEmptyObject],
  ['m-lexicon-segment-echo', lexiconSegmentEcho],
  ['m-breed-zero-orders-0-totalamount', zeroTotal],
  ['m-breed-zero-orders-0-items-0-count', zeroItemCount],
  ['m-breed-truncate-orders-0-status', truncateStatus],
  ['m-breed-lower-orders-0-status', lowerStatus],
  ['m-breed-null-fields-menu', nullMenu],
  ['m-breed-duplicate-first-menu', dupFirstMenu],
  ['m-breed-drop-first-menu', dropFirstMenu],
  ['m-breed-blank-status-log-0-type', blankLogType],
  ['m-breed-truncate-status-log-0-type', truncateLogType],

  ['m-lab-slot-conflict-ignore', labSlotConflictIgnore],
  ['m-lab-otp-window-ignore', labOtpWindowIgnore],
  ['m-lab-borrow-stock-frozen', labBorrowStockFrozen],
  ['m-lab-approve-not-pending', labApproveNotPending],
  ['m-cron-skip-slot', cronSkipSlot],
  ['m-cron-double-fire', cronDoubleFire],
  ['m-cron-drift', cronDrift],

  // 咖啡店第二观测通道（taixianglian-sql）：L2 写后事实层的敌人。
  ['m-sql-phantom-success', sqlPhantomSuccess],
  ['m-sql-cross-user-leak', sqlCrossUserLeak],
  ['m-sql-log-type-flip', sqlLogTypeFlip],
  ['m-log-order-swap', logOrderSwap],
  ['m-sql-total-drift', sqlTotalDrift],
  ['m-unit-price-flip', unitPriceFlip],

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

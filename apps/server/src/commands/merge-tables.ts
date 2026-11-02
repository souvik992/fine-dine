import { mergeTablesSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitTableState, reopenIfBilled } from './order-support.js';
import { firedItemsOf, loadOrder, requireLive, sendMoveNotices, tableLabel, touchOther } from './table-support.js';

/**
 * Joins another table's order into this one (docs/03): its lines move here (original_order_id kept, KOT links and
 * KOT rows unchanged), covers add up, the other order becomes `merged` and its table is freed. Printed bills of
 * either order are superseded. Stations with sent items get a "MERGED T4 -> T9" notice; leakage flag if any.
 */
export const mergeTables = defineCommand({
  type: 'MergeTables',
  schema: mergeTablesSchema,
  right: 'table.merge',
  needsOrder: true,
  apply(ctx, p, order) {
    const target = order!;
    requireLive(target, 'This order');
    if (p.sourceOrderId === target.id) throw new PosError('INVALID_STATE', 'Choose another table to merge in.', { orderId: target.id });
    const source = loadOrder(ctx, p.sourceOrderId);
    requireLive(source, `The order on ${tableLabel(ctx, source.table_id)}`);
    const { db } = ctx;
    const fromLabel = tableLabel(ctx, source.table_id);
    const toLabel = tableLabel(ctx, target.table_id);
    const fired = firedItemsOf(ctx, source.id);
    const moved = db.prepare('SELECT id FROM order_item WHERE order_id = ?').pluck().all(source.id) as string[];

    touchOther(ctx, source); // supersedes its printed bill, version + 1
    reopenIfBilled(ctx, target);
    db.prepare('UPDATE order_item SET original_order_id = coalesce(original_order_id, order_id), order_id = ? WHERE order_id = ?').run(target.id, source.id);
    db.prepare('UPDATE "order" SET covers = coalesce(covers, 0) + coalesce(?, 0) WHERE id = ?').run(source.covers, target.id);
    db.prepare(`UPDATE "order" SET state = 'merged', merged_into = ?, closed_at = ? WHERE id = ?`).run(target.id, ctx.nowIso, source.id);
    db.prepare('UPDATE dining_table SET open_order_id = NULL WHERE open_order_id = ?').run(source.id);

    const notices = sendMoveNotices(ctx, loadOrder(ctx, target.id), fired, `MERGED ${fromLabel} -> ${toLabel}`, false);
    const audit = { before: { sourceTable: fromLabel, targetTable: toLabel }, after: { movedItemIds: moved, noticeKotNos: notices }, leakage: fired.length > 0 };
    ctx.audit({ entity: 'order', entityId: target.id, action: 'order.merge_in', ...audit, after: { ...audit.after, sourceOrderId: source.id } });
    ctx.audit({ entity: 'order', entityId: source.id, action: 'order.merged', before: { state: source.state }, after: { state: 'merged', mergedInto: target.id }, leakage: fired.length > 0 });
    emitTableState(ctx, source.table_id);
    emitTableState(ctx, target.table_id);
    return { result: { orderId: target.id, mergedOrderId: source.id, movedItems: moved.length, noticeKotNos: notices } };
  },
});

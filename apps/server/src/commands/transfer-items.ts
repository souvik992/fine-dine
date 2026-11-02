import { transferItemsSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitTableState, reopenIfBilled } from './order-support.js';
import { loadOrder, requireLive, sendMoveNotices, tableLabel, touchOther, type FiredMove } from './table-support.js';

/**
 * Moves whole lines (held or sent) to another open order (docs/03). Sent lines keep their KOT link; their stations
 * get an "ITEMS T4 -> T9" notice listing them, and the move is a leakage flag. Printed bills are superseded.
 */
export const transferItems = defineCommand({
  type: 'TransferItems',
  schema: transferItemsSchema,
  right: 'item.transfer',
  needsOrder: true,
  apply(ctx, p, order) {
    const from = order!;
    requireLive(from, 'This order');
    if (p.toOrderId === from.id) throw new PosError('INVALID_STATE', 'Choose another table to move the items to.', { orderId: from.id });
    const to = loadOrder(ctx, p.toOrderId);
    requireLive(to, `The order on ${tableLabel(ctx, to.table_id)}`);
    const { db } = ctx;
    const rows = db
      .prepare(`SELECT id, status, station_id, qty, name_snapshot AS name, course, note FROM order_item WHERE order_id = ? AND id IN (SELECT value FROM json_each(?))`)
      .all(from.id, JSON.stringify(p.itemIds)) as Array<FiredMove & { id: string; status: string }>;
    if (rows.length !== p.itemIds.length) {
      const missing = p.itemIds.filter((id) => !rows.some((r) => r.id === id));
      throw new PosError('NOT_FOUND', 'Some items are not on this order.', { orderItemIds: missing });
    }
    const cancelled = rows.filter((r) => r.status === 'cancelled');
    if (cancelled.length) throw new PosError('INVALID_STATE', 'Cancelled items cannot be moved.', { orderItemIds: cancelled.map((r) => r.id) });

    reopenIfBilled(ctx, from);
    touchOther(ctx, to);
    const move = db.prepare('UPDATE order_item SET original_order_id = coalesce(original_order_id, order_id), order_id = ? WHERE id = ?');
    for (const r of rows) move.run(to.id, r.id);

    const fired = rows.filter((r) => r.status === 'fired');
    const fromLabel = tableLabel(ctx, from.table_id);
    const toLabel = tableLabel(ctx, to.table_id);
    const notices = sendMoveNotices(ctx, loadOrder(ctx, to.id), fired, `ITEMS ${fromLabel} -> ${toLabel}`, true);
    ctx.audit({
      entity: 'order',
      entityId: from.id,
      action: 'order.transfer_items',
      before: { table: fromLabel },
      after: { toOrderId: to.id, table: toLabel, items: rows.map((r) => ({ id: r.id, name: r.name, qty: r.qty, status: r.status })), noticeKotNos: notices },
      leakage: fired.length > 0,
    });
    emitTableState(ctx, from.table_id);
    emitTableState(ctx, to.table_id);
    return { result: { toOrderId: to.id, moved: rows.length, noticeKotNos: notices } };
  },
});

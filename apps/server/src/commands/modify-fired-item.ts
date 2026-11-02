import { modifyFiredItemSchema, newId } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { loadFiredLine, sendChangeSlip } from './fired-item-support.js';
import { emitTableState, reopenIfBilled, requireEditable } from './order-support.js';

/**
 * Reduce a line already sent to the kitchen (docs/03). The removed part becomes a `cancelled` line on the same
 * KOT (history kept, left off the bill); add-ons are charged per line, so they stay with the remaining part.
 * A `modify` slip goes to the station. Leakage flag; a manager PIN when the role needs one for kot.modify.
 */
export const modifyFiredItem = defineCommand({
  type: 'ModifyFiredItem',
  schema: modifyFiredItemSchema,
  right: 'kot.modify',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireEditable(o);
    const line = loadFiredLine(ctx, o, p.orderItemId);
    if (p.newQty >= line.qty) {
      throw new PosError('INVALID_STATE', `Only a reduction is possible here (now ${line.qty}). To add more, add the item again and send it.`, { qty: line.qty });
    }
    const removed = line.qty - p.newQty;
    const { db } = ctx;
    db.prepare('UPDATE order_item SET qty = ? WHERE id = ?').run(p.newQty, line.id);
    const cancelledId = newId();
    db.prepare(
      `INSERT INTO order_item (id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_paise, tax_rate_bp, note, course, station_id, kot_id, status, added_by, added_at, original_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cancelled', ?, ?, ?)`,
    ).run(
      cancelledId,
      o.id,
      line.item_id,
      line.variant_id,
      line.name_snapshot,
      removed,
      line.unit_price_paise,
      line.tax_rate_bp,
      line.note,
      line.course,
      line.station_id,
      line.kot_id,
      line.added_by,
      line.added_at,
      line.original_order_id,
    );

    const slip = sendChangeSlip(ctx, o, line, {
      kind: 'modify',
      removedQty: removed,
      nowQty: p.newQty,
      reason: p.reason,
      stock: p.returnToStock ? { itemId: line.item_id, variantId: line.variant_id, qty: removed, addons: [] } : null,
    });
    ctx.audit({
      entity: 'order_item',
      entityId: line.id,
      action: 'item.modify_fired',
      before: { qty: line.qty, kotNo: line.kot_no },
      after: { qty: p.newQty, cancelledLineId: cancelledId, slipKotNo: slip.kotNo, returnToStock: p.returnToStock },
      reason: p.reason,
      leakage: true,
    });
    reopenIfBilled(ctx, o);
    emitTableState(ctx, o.table_id);
    return { result: { orderItemId: line.id, qty: p.newQty, kotId: slip.id, kotNo: slip.kotNo } };
  },
});

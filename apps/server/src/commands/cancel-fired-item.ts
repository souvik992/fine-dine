import { cancelFiredItemSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { loadFiredLine, sendChangeSlip } from './fired-item-support.js';
import { emitTableState, reopenIfBilled, requireEditable } from './order-support.js';
import { useLinesOf } from './stock-support.js';

/**
 * Cancel a line already sent to the kitchen (docs/03): it stays on its KOT as `cancelled` (never deleted, left off
 * the bill) and a `cancel` slip goes to the station. Leakage flag; a manager PIN when the role needs one.
 */
export const cancelFiredItem = defineCommand({
  type: 'CancelFiredItem',
  schema: cancelFiredItemSchema,
  right: 'kot.cancel',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireEditable(o);
    const line = loadFiredLine(ctx, o, p.orderItemId);
    const stock = p.returnToStock ? (useLinesOf(ctx.db, [line.id])[0] ?? null) : null;
    ctx.db.prepare(`UPDATE order_item SET status = 'cancelled' WHERE id = ?`).run(line.id);
    const slip = sendChangeSlip(ctx, o, line, { kind: 'cancel', removedQty: line.qty, nowQty: null, reason: p.reason, stock });
    ctx.audit({
      entity: 'order_item',
      entityId: line.id,
      action: 'item.cancel_fired',
      before: { qty: line.qty, status: 'fired', kotNo: line.kot_no },
      after: { status: 'cancelled', slipKotNo: slip.kotNo, returnToStock: p.returnToStock },
      reason: p.reason,
      leakage: true,
    });
    reopenIfBilled(ctx, o);
    emitTableState(ctx, o.table_id);
    return { result: { orderItemId: line.id, kotId: slip.id, kotNo: slip.kotNo } };
  },
});

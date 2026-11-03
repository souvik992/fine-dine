import { releaseTableSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitTableState } from './order-support.js';

/**
 * Frees the table of an order that has nothing to bill: opened by mistake, or the guests left before ordering. Only
 * while nothing sent to the kitchen is still on it (cancel those first, CancelFiredItem) and no bill number was given
 * (that bill is voided instead, so the numbers stay gap-free). Items not yet sent are dropped with it. The order ends
 * `void` (out of sales); nothing is deleted from the record: the audit row keeps what it held.
 */
export const releaseTable = defineCommand({
  type: 'ReleaseTable',
  schema: releaseTableSchema,
  right: 'order.create',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    if (o.type === 'online') throw new PosError('INVALID_STATE', 'An online order is closed by rejecting or cancelling it on the Online orders screen.');
    if (o.state !== 'open') throw new PosError('INVALID_STATE', o.state === 'billed' ? 'A bill was printed for this table. Void the bill instead.' : `This order is ${o.state}; the table is already free.`, { state: o.state });
    const fired = ctx.db.prepare(`SELECT count(*) FROM order_item WHERE order_id = ? AND status = 'fired'`).pluck().get(o.id) as number;
    if (fired > 0) {
      throw new PosError('INVALID_STATE', `${fired} item${fired === 1 ? ' was' : 's were'} sent to the kitchen. Cancel ${fired === 1 ? 'it' : 'them'} first (with a reason), or bill the table.`, { fired });
    }
    if (ctx.db.prepare('SELECT 1 FROM bill WHERE order_id = ?').get(o.id)) {
      throw new PosError('INVALID_STATE', 'This order was given a bill number. Print the bill again and void it, so the number is accounted for.', { reason: 'has_bill' });
    }

    const held = ctx.db.prepare(`SELECT id, item_id, name_snapshot, qty FROM order_item WHERE order_id = ? AND status = 'held'`).all(o.id) as Array<{ id: string }>;
    for (const h of held) {
      ctx.db.prepare('DELETE FROM order_item_addon WHERE order_item_id = ?').run(h.id);
      ctx.db.prepare('DELETE FROM order_item WHERE id = ?').run(h.id);
    }
    ctx.db.prepare(`UPDATE "order" SET state = 'void', closed_at = ? WHERE id = ?`).run(ctx.nowIso, o.id);
    ctx.db.prepare('UPDATE dining_table SET open_order_id = NULL WHERE open_order_id = ?').run(o.id);
    ctx.db.prepare('DELETE FROM bill_request WHERE order_id = ?').run(o.id); // nothing left to bill
    ctx.audit({
      entity: 'order',
      entityId: o.id,
      action: 'order.release',
      before: { state: 'open', tableId: o.table_id, covers: o.covers, heldItems: held },
      after: { state: 'void' },
      reason: p.reason ?? null,
    });
    emitTableState(ctx, o.table_id);
    return { result: { orderId: o.id, tableId: o.table_id, droppedItems: held.length } };
  },
});

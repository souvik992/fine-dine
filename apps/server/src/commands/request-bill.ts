import { requestBillSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitTableState } from './order-support.js';

/**
 * A captain asks the counter for this table's bill (docs/09 "Request bill (notifies desk)", P3-04). Shows on every
 * terminal until the bill is printed. Asking again moves the time on (the guests are still waiting).
 */
export const requestBill = defineCommand({
  type: 'RequestBill',
  schema: requestBillSchema,
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, _p, order) {
    const o = order!;
    const { db } = ctx;
    if (o.state === 'billed') throw new PosError('INVALID_STATE', 'The bill is already printed.', { state: o.state });
    if (o.state !== 'open') throw new PosError('INVALID_STATE', `This order is ${o.state}; it can no longer be billed.`, { state: o.state });
    if (!db.prepare("SELECT 1 FROM order_item WHERE order_id = ? AND status = 'fired' LIMIT 1").get(o.id)) {
      throw new PosError('INVALID_STATE', 'Nothing has been sent to the kitchen yet.');
    }
    const before = db.prepare('SELECT requested_at FROM bill_request WHERE order_id = ?').pluck().get(o.id) as string | undefined;
    db.prepare(
      `INSERT INTO bill_request (order_id, requested_at, requested_by) VALUES (?, ?, ?)
       ON CONFLICT (order_id) DO UPDATE SET requested_at = excluded.requested_at, requested_by = excluded.requested_by`,
    ).run(o.id, ctx.nowIso, ctx.actor.userId);

    const table = o.table_id ? (db.prepare('SELECT label FROM dining_table WHERE id = ?').pluck().get(o.table_id) as string | undefined) : undefined;
    const byName = ctx.actor.userId ? (db.prepare('SELECT name FROM app_user WHERE id = ?').pluck().get(ctx.actor.userId) as string | undefined) : undefined;
    ctx.audit({ entity: 'order', entityId: o.id, action: 'order.bill_request', before: before ? { requestedAt: before } : null, after: { requestedAt: ctx.nowIso } });
    ctx.emit('floor', 'bill.requested', { orderId: o.id, tableId: o.table_id, tableLabel: table ?? null, byName: byName ?? null, at: ctx.nowIso });
    emitTableState(ctx, o.table_id);
    return { result: { requestedAt: ctx.nowIso } };
  },
});

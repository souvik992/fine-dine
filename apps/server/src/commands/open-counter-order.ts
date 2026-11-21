import { newId, openCounterOrderSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitCounterOrders, nextCounter } from './order-support.js';

/**
 * Opens a takeaway or delivery order from the floor: no table, no covers, a ticket number for the business day (one
 * sequence for both, so "#12" is never two orders at once). Billed, settled and cancelled like any order; a delivery
 * keeps the customer's phone and address for the bill.
 */
export const openCounterOrder = defineCommand({
  type: 'OpenCounterOrder',
  schema: openCounterOrderSchema,
  right: 'order.create',
  needsOrder: false,
  apply(ctx, p) {
    const { db } = ctx;
    const orderId = p.orderId ?? newId();
    if (db.prepare('SELECT 1 FROM "order" WHERE id = ?').get(orderId)) {
      throw new PosError('INVALID_STATE', 'That order id is already in use.', {
        orderId,
      });
    }
    const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);
    const name = blank(p.customerName);
    const phone = blank(p.customerPhone);
    const address = p.type === 'delivery' ? blank(p.address) : null;
    const ticketNo = nextCounter(db, `ticket:${ctx.businessDate}`);

    db.prepare(
      `INSERT INTO "order" (id, business_date, table_id, type, covers, captain_id, customer_name, customer_phone, delivery_address, ticket_no,
                            state, version, opened_at, opened_by)
       VALUES (?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, 'open', 1, ?, ?)`,
    ).run(orderId, ctx.businessDate, p.type, name, phone, address, ticketNo, ctx.nowIso, ctx.actor.userId);

    ctx.audit({
      entity: 'order',
      entityId: orderId,
      action: 'order.open',
      after: {
        type: p.type,
        ticketNo,
        customerName: name,
        customerPhone: phone,
        address,
      },
    });
    emitCounterOrders(ctx, orderId);
    return { orderId, result: { orderId, ticketNo } };
  },
});

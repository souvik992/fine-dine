import { seatFromWaitlistSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { openOrderOnTable } from './open-table.js';
import { bookingsChanged } from './reservation-support.js';
import { requireWaiting } from './waitlist-support.js';

/** A waiting guest gets a table: an order opens there (a table held for a booking needs "Seat anyway"). */
export const seatFromWaitlist = defineCommand({
  type: 'SeatFromWaitlist',
  schema: seatFromWaitlistSchema,
  right: 'order.create',
  needsOrder: false,
  apply(ctx, p) {
    const e = requireWaiting(ctx, p.entryId);
    const { orderId, tableLabel } = openOrderOnTable(ctx, { tableId: p.tableId, covers: p.covers ?? e.party_size, orderId: p.orderId, ignoreReservation: p.ignoreReservation });
    ctx.db.prepare("UPDATE waitlist_entry SET status = 'seated', closed_at = ?, table_id = ?, order_id = ? WHERE id = ?").run(ctx.nowIso, p.tableId, orderId, e.id);
    ctx.audit({ entity: 'waitlist_entry', entityId: e.id, action: 'waitlist.seat', before: { status: 'waiting' }, after: { status: 'seated', orderId, tableId: p.tableId } });
    bookingsChanged(ctx, { waitlistEntryId: e.id });
    return { orderId, result: { orderId, tableLabel } };
  },
});

import { seatReservationSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { openOrderOnTable } from './open-table.js';
import { bookingsChanged, requireBooked, requireReservation, tablesOf } from './reservation-support.js';

/** The booked guests arrived: an order opens on their table (or another free one) and the booking is done. */
export const seatReservation = defineCommand({
  type: 'SeatReservation',
  schema: seatReservationSchema,
  right: 'order.create',
  needsOrder: false,
  apply(ctx, p) {
    const r = requireReservation(ctx, p.reservationId);
    requireBooked(r);
    const tableId = p.tableId ?? tablesOf(ctx.db, r.id)[0];
    if (!tableId) throw new PosError('VALIDATION', 'Choose a table for this booking.', { field: 'tableId' });
    const { orderId, tableLabel } = openOrderOnTable(ctx, { tableId, covers: p.covers ?? r.party_size, orderId: p.orderId, forReservationId: r.id });
    ctx.db.prepare("UPDATE reservation SET status = 'seated', order_id = ?, closed_at = ? WHERE id = ?").run(orderId, ctx.nowIso, r.id);
    ctx.audit({ entity: 'reservation', entityId: r.id, action: 'reservation.seat', before: { status: 'booked' }, after: { status: 'seated', orderId, tableId } });
    bookingsChanged(ctx, { reservationId: r.id });
    return { orderId, result: { orderId, tableLabel } };
  },
});

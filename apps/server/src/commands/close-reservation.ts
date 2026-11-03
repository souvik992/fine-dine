import { closeReservationSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { bookingsChanged, requireBooked, requireReservation } from './reservation-support.js';

/** The guest cancelled, or did not come (no-show): the booking stops holding its tables. Kept, never deleted. */
export const closeReservation = defineCommand({
  type: 'CloseReservation',
  schema: closeReservationSchema,
  right: 'reservation.manage',
  needsOrder: false,
  apply(ctx, p) {
    const r = requireReservation(ctx, p.reservationId);
    requireBooked(r);
    ctx.db.prepare('UPDATE reservation SET status = ?, closed_at = ? WHERE id = ?').run(p.outcome, ctx.nowIso, r.id);
    ctx.audit({
      entity: 'reservation',
      entityId: r.id,
      action: p.outcome === 'no_show' ? 'reservation.no_show' : 'reservation.cancel',
      before: { status: 'booked' },
      after: { status: p.outcome },
    });
    bookingsChanged(ctx, { reservationId: r.id });
    return { result: { reservationId: r.id, status: p.outcome } };
  },
});

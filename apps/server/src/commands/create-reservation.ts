import { createReservationSchema, newId } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { bookingsChanged, refuseClashes, requireBookableTables } from './reservation-support.js';

/** How far back a booking may start (entering one for guests who just arrived). */
export const PAST_GRACE_MS = 10 * 60_000;

/** A table booking (P4-04): guest, party, time and length, tables. Two bookings never share a table at once. */
export const createReservation = defineCommand({
  type: 'CreateReservation',
  schema: createReservationSchema,
  right: 'reservation.manage',
  needsOrder: false,
  apply(ctx, p) {
    const startsAt = new Date(p.startsAt).toISOString();
    if (Date.parse(startsAt) < ctx.now.getTime() - PAST_GRACE_MS) throw new PosError('VALIDATION', 'That time has already passed.', { field: 'startsAt' });
    const id = p.id ?? newId();
    if (ctx.db.prepare('SELECT 1 FROM reservation WHERE id = ?').get(id)) throw new PosError('INVALID_STATE', 'That booking id is already in use.', { id });
    requireBookableTables(ctx, p.tableIds);
    refuseClashes(ctx, p.tableIds, startsAt, p.durationMin, null);

    ctx.db
      .prepare(
        `INSERT INTO reservation (id, guest_name, phone, party_size, starts_at, duration_min, note, status, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?)`,
      )
      .run(id, p.guestName, p.phone, p.partySize, startsAt, p.durationMin, p.note, ctx.nowIso, ctx.actor.userId);
    const link = ctx.db.prepare('INSERT INTO reservation_table (reservation_id, table_id) VALUES (?, ?)');
    for (const t of p.tableIds) link.run(id, t);

    ctx.audit({
      entity: 'reservation',
      entityId: id,
      action: 'reservation.create',
      after: { guestName: p.guestName, partySize: p.partySize, startsAt, durationMin: p.durationMin, tableIds: p.tableIds },
    });
    bookingsChanged(ctx, { reservationId: id });
    return { result: { reservationId: id } };
  },
});

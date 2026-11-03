import { updateReservationSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { PAST_GRACE_MS } from './create-reservation.js';
import { bookingsChanged, refuseClashes, requireBookableTables, requireBooked, requireReservation, tablesOf } from './reservation-support.js';

/** Changes a booking that is still `booked` (time, party, tables, contact, note); audited before/after. */
export const updateReservation = defineCommand({
  type: 'UpdateReservation',
  schema: updateReservationSchema,
  right: 'reservation.manage',
  needsOrder: false,
  apply(ctx, p) {
    const r = requireReservation(ctx, p.reservationId);
    requireBooked(r);
    const beforeTables = tablesOf(ctx.db, r.id);
    const next = {
      guestName: p.guestName ?? r.guest_name,
      phone: p.phone === undefined ? r.phone : p.phone,
      partySize: p.partySize ?? r.party_size,
      startsAt: p.startsAt ? new Date(p.startsAt).toISOString() : r.starts_at,
      durationMin: p.durationMin ?? r.duration_min,
      note: p.note === undefined ? r.note : p.note,
      tableIds: p.tableIds ?? beforeTables,
    };
    if (p.startsAt && Date.parse(next.startsAt) < ctx.now.getTime() - PAST_GRACE_MS) throw new PosError('VALIDATION', 'That time has already passed.', { field: 'startsAt' });
    requireBookableTables(ctx, next.tableIds);
    refuseClashes(ctx, next.tableIds, next.startsAt, next.durationMin, r.id);

    ctx.db
      .prepare('UPDATE reservation SET guest_name = ?, phone = ?, party_size = ?, starts_at = ?, duration_min = ?, note = ? WHERE id = ?')
      .run(next.guestName, next.phone, next.partySize, next.startsAt, next.durationMin, next.note, r.id);
    if (p.tableIds) {
      ctx.db.prepare('DELETE FROM reservation_table WHERE reservation_id = ?').run(r.id);
      const link = ctx.db.prepare('INSERT INTO reservation_table (reservation_id, table_id) VALUES (?, ?)');
      for (const t of p.tableIds) link.run(r.id, t);
    }
    ctx.audit({
      entity: 'reservation',
      entityId: r.id,
      action: 'reservation.update',
      before: { guestName: r.guest_name, phone: r.phone, partySize: r.party_size, startsAt: r.starts_at, durationMin: r.duration_min, note: r.note, tableIds: beforeTables },
      after: next,
    });
    bookingsChanged(ctx, { reservationId: r.id });
    return { result: { reservationId: r.id } };
  },
});

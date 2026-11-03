// Bookings and the waitlist (P4-04): which booking holds a table now, and clashes between bookings.
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';

export interface ReservationRow {
  id: string;
  guest_name: string;
  phone: string | null;
  party_size: number;
  starts_at: string;
  duration_min: number;
  note: string | null;
  status: 'booked' | 'seated' | 'cancelled' | 'no_show';
  order_id: string | null;
}

const MIN = 60_000;

/** "19:30" in the outlet's time zone. */
export function localTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(iso));
}

/** The booking holding this table at `now`: booked, from `holdMin` before its time until `graceMin` after it. */
export function holdingBooking(db: Db, tableId: string, now: Date, exceptReservationId?: string): ReservationRow | null {
  const config = getConfig(db);
  const rows = db
    .prepare(
      `SELECT r.* FROM reservation r JOIN reservation_table rt ON rt.reservation_id = r.id
       WHERE rt.table_id = ? AND r.status = 'booked' ORDER BY r.starts_at`,
    )
    .all(tableId) as ReservationRow[];
  const t = now.getTime();
  return (
    rows.find((r) => {
      if (r.id === exceptReservationId) return false;
      const start = Date.parse(r.starts_at);
      return t >= start - config['reservation.holdMin'] * MIN && t < start + config['reservation.graceMin'] * MIN;
    }) ?? null
  );
}

/** Refuses a walk-in on a table held for a booking, naming the guest and time (docs/09: "Seat anyway" overrides). */
export function refuseIfHeld(ctx: CommandContext, table: { id: string; label: string }, exceptReservationId?: string): void {
  const r = holdingBooking(ctx.db, table.id, ctx.now, exceptReservationId);
  if (!r) return;
  throw new PosError('INVALID_STATE', `Table ${table.label} is held for ${r.guest_name} (${r.party_size}) at ${localTime(r.starts_at, ctx.timeZone)}.`, {
    reason: 'reserved',
    reservationId: r.id,
    tableId: table.id,
  });
}

/** Two bookings may not share a table at overlapping times. */
export function refuseClashes(ctx: CommandContext, tableIds: readonly string[], startsAt: string, durationMin: number, exceptReservationId: string | null): void {
  const start = Date.parse(startsAt);
  const end = start + durationMin * MIN;
  for (const tableId of tableIds) {
    const others = ctx.db
      .prepare(
        `SELECT r.id, r.guest_name, r.starts_at, r.duration_min, t.label FROM reservation r
         JOIN reservation_table rt ON rt.reservation_id = r.id JOIN dining_table t ON t.id = rt.table_id
         WHERE rt.table_id = ? AND r.status = 'booked' AND r.id <> coalesce(?, '')`,
      )
      .all(tableId, exceptReservationId) as Array<{ id: string; guest_name: string; starts_at: string; duration_min: number; label: string }>;
    for (const o of others) {
      const oStart = Date.parse(o.starts_at);
      if (start < oStart + o.duration_min * MIN && oStart < end) {
        throw new PosError(
          'INVALID_STATE',
          `Table ${o.label} is already booked for ${o.guest_name} ${localTime(o.starts_at, ctx.timeZone)}–${localTime(new Date(oStart + o.duration_min * MIN).toISOString(), ctx.timeZone)}.`,
          { reason: 'clash', reservationId: o.id, tableId },
        );
      }
    }
  }
}

/** Tables to book: they exist and are not blocked. */
export function requireBookableTables(ctx: CommandContext, tableIds: readonly string[]): void {
  for (const id of tableIds) {
    const t = ctx.db.prepare('SELECT label, status FROM dining_table WHERE id = ?').get(id) as { label: string; status: string } | undefined;
    if (!t) throw new PosError('NOT_FOUND', 'Table not found.', { tableId: id });
    if (t.status === 'blocked') throw new PosError('INVALID_STATE', `Table ${t.label} is blocked.`, { tableId: id });
  }
}

export function requireReservation(ctx: CommandContext, id: string): ReservationRow {
  const r = ctx.db.prepare('SELECT * FROM reservation WHERE id = ?').get(id) as ReservationRow | undefined;
  if (!r) throw new PosError('NOT_FOUND', 'Booking not found.', { reservationId: id });
  return r;
}

export function requireBooked(r: ReservationRow): void {
  if (r.status !== 'booked') throw new PosError('INVALID_STATE', `This booking is ${r.status.replace('_', '-')}.`, { status: r.status });
}

export const tablesOf = (db: Db, reservationId: string): string[] =>
  db.prepare('SELECT table_id FROM reservation_table WHERE reservation_id = ? ORDER BY rowid').pluck().all(reservationId) as string[];

/** Bookings and the waitlist changed: terminals refresh their lists and the floor (table holds). */
export function bookingsChanged(ctx: CommandContext, data: Record<string, unknown>): void {
  ctx.emit(['floor', 'reservations'], 'reservations.changed', data);
}

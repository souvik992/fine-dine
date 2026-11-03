// Bookings and the waitlist as the terminals show them (P4-04).
import { isoInZone, localDate, type Reservation, type ReservationDay, type TableBooking, type Waitlist } from '@dinepos/shared';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';
import { dayBounds } from '../reports/audit.js';

const MIN = 60_000;

interface Row {
  id: string;
  guest_name: string;
  phone: string | null;
  party_size: number;
  starts_at: string;
  duration_min: number;
  note: string | null;
  status: Reservation['status'];
  order_id: string | null;
  created_at: string;
  created_by_name: string | null;
}

/** Every booking of one local date (all statuses), in time order, with its tables. */
export function getReservationDay(db: Db, date: string, now: Date, timeZone: string): ReservationDay {
  const config = getConfig(db);
  const { start, end } = dayBounds(date, date, timeZone);
  const rows = db
    .prepare(
      `SELECT r.*, u.name AS created_by_name FROM reservation r LEFT JOIN app_user u ON u.id = r.created_by
       WHERE r.starts_at >= ? AND r.starts_at < ? ORDER BY r.starts_at, r.guest_name`,
    )
    .all(start, end) as Row[];
  const tables = db.prepare('SELECT t.id, t.label FROM reservation_table rt JOIN dining_table t ON t.id = rt.table_id WHERE rt.reservation_id = ? ORDER BY rt.rowid');
  const grace = config['reservation.graceMin'] * MIN;
  const reservations = rows.map(
    (r): Reservation => ({
      id: r.id,
      guestName: r.guest_name,
      ...(r.phone ? { phone: r.phone } : {}),
      partySize: r.party_size,
      startsAt: r.starts_at,
      durationMin: r.duration_min,
      ...(r.note ? { note: r.note } : {}),
      status: r.status,
      tables: tables.all(r.id) as Array<{ id: string; label: string }>,
      ...(r.order_id ? { orderId: r.order_id } : {}),
      createdAt: r.created_at,
      ...(r.created_by_name ? { createdByName: r.created_by_name } : {}),
      late: r.status === 'booked' && now.getTime() >= Date.parse(r.starts_at) + grace,
    }),
  );
  return { date, serverTime: isoInZone(now, timeZone), holdMin: config['reservation.holdMin'], graceMin: config['reservation.graceMin'], reservations };
}

/** Guests still waiting, first come first, with how long they have waited. */
export function getWaitlist(db: Db, now: Date, timeZone: string): Waitlist {
  const rows = db
    .prepare(`SELECT id, guest_name, phone, party_size, quoted_min, note, joined_at FROM waitlist_entry WHERE status = 'waiting' ORDER BY joined_at, rowid`)
    .all() as Array<{ id: string; guest_name: string; phone: string | null; party_size: number; quoted_min: number | null; note: string | null; joined_at: string }>;
  return {
    serverTime: isoInZone(now, timeZone),
    entries: rows.map((r) => ({
      id: r.id,
      guestName: r.guest_name,
      ...(r.phone ? { phone: r.phone } : {}),
      partySize: r.party_size,
      ...(r.quoted_min !== null ? { quotedMin: r.quoted_min } : {}),
      ...(r.note ? { note: r.note } : {}),
      joinedAt: r.joined_at,
      waitedMin: Math.max(0, Math.floor((now.getTime() - Date.parse(r.joined_at)) / MIN)),
    })),
  };
}

/**
 * Each table's next booking still to come today (or late but within its grace). `holding` = it holds the table now,
 * from `holdMin` before its time until `graceMin` after it.
 */
export function nextBookings(db: Db, now: Date, timeZone: string): Map<string, TableBooking> {
  const config = getConfig(db);
  const { end } = dayBounds(localDate(now, timeZone), localDate(now, timeZone), timeZone);
  const graceMs = config['reservation.graceMin'] * MIN;
  const rows = db
    .prepare(
      `SELECT rt.table_id, r.id, r.guest_name, r.party_size, r.starts_at FROM reservation r JOIN reservation_table rt ON rt.reservation_id = r.id
       WHERE r.status = 'booked' AND r.starts_at < ? AND r.starts_at > ? ORDER BY r.starts_at`,
    )
    .all(end, new Date(now.getTime() - graceMs).toISOString()) as Array<{ table_id: string; id: string; guest_name: string; party_size: number; starts_at: string }>;
  const out = new Map<string, TableBooking>();
  for (const r of rows) {
    if (out.has(r.table_id)) continue;
    const start = Date.parse(r.starts_at);
    out.set(r.table_id, {
      reservationId: r.id,
      guestName: r.guest_name,
      partySize: r.party_size,
      startsAt: r.starts_at,
      holding: now.getTime() >= start - config['reservation.holdMin'] * MIN,
    });
  }
  return out;
}

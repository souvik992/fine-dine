import { addDays, localDate } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

export interface BusinessDayRow {
  date: string;
  opened_at: string;
  closed_at: string | null;
}

/** The open business date, or null when none is open. */
export function currentBusinessDate(db: Db): string | null {
  return (
    (db.prepare('SELECT date FROM business_day WHERE closed_at IS NULL ORDER BY date DESC LIMIT 1').pluck().get() as
      | string
      | undefined) ?? null
  );
}

/**
 * Opens the next business date and audits it as a system action. Call inside a transaction, only when no
 * date is open. The date is today's local date, or the day after the last closed one if that is later
 * (a DayEnd run before midnight must not reopen the same date).
 */
export function openNextBusinessDay(db: Db, timeZone: string, at: Date, reason: string): string {
  const lastClosed = db.prepare('SELECT max(date) FROM business_day').pluck().get() as string | null;
  const today = localDate(at, timeZone);
  const date = lastClosed && lastClosed >= today ? addDays(lastClosed, 1) : today;
  const ts = at.toISOString();
  db.prepare('INSERT INTO business_day (date, opened_at) VALUES (?, ?)').run(date, ts);
  db.prepare(
    `INSERT INTO audit_event (ts, entity, entity_id, action, after_json, reason)
     VALUES (?, 'business_day', ?, 'day.open', ?, ?)`,
  ).run(ts, date, JSON.stringify({ date, openedAt: ts, timeZone }), reason);
  return date;
}

/**
 * Makes sure a business date is open; returns it. Runs at startup, before any client can connect. P2-09: a new date
 * opens only when the licence allows it (`mayOpen`); a date already open is never closed by a licence. Null = none.
 */
export function ensureBusinessDay(db: Db, timeZone: string, now: () => Date = () => new Date(), mayOpen: () => boolean = () => true): string | null {
  return db
    .transaction(() => currentBusinessDate(db) ?? (mayOpen() ? openNextBusinessDay(db, timeZone, now(), 'server start: no open business date') : null))
    .immediate();
}

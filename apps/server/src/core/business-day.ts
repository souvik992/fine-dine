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
 * Makes sure exactly one business date is open; returns it. Runs at startup, before any client can connect.
 * When none is open the server opens today's local date, or the day after the last closed one if that is
 * later (a DayEnd run early for today must not reopen today). Audited as a system action.
 */
export function ensureBusinessDay(db: Db, timeZone: string, now: () => Date = () => new Date()): string {
  return db
    .transaction(() => {
      const open = currentBusinessDate(db);
      if (open) return open;

      const at = now();
      const lastClosed = db.prepare('SELECT max(date) FROM business_day').pluck().get() as string | null;
      const today = localDate(at, timeZone);
      const date = lastClosed && lastClosed >= today ? addDays(lastClosed, 1) : today;
      const ts = at.toISOString();

      db.prepare('INSERT INTO business_day (date, opened_at) VALUES (?, ?)').run(date, ts);
      db.prepare(
        `INSERT INTO audit_event (ts, entity, entity_id, action, after_json, reason)
         VALUES (?, 'business_day', ?, 'day.open', ?, 'server start: no open business date')`,
      ).run(ts, date, JSON.stringify({ date, openedAt: ts, timeZone }));
      return date;
    })
    .immediate();
}

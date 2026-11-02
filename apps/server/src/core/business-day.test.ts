import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection.js';
import { createTestDb } from '../testing/test-db.js';
import { currentBusinessDate, ensureBusinessDay } from './business-day.js';

const IST = 'Asia/Kolkata';
let db: Db;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => db.close());

describe('ensureBusinessDay', () => {
  it('opens today in the outlet time zone on a fresh database', () => {
    // 20:00 UTC on 1 Nov = 01:30 IST on 2 Nov.
    expect(ensureBusinessDay(db, IST, () => new Date('2026-11-01T20:00:00Z'))).toBe('2026-11-02');
    expect(currentBusinessDate(db)).toBe('2026-11-02');
  });

  it('audits the opening as a system action', () => {
    ensureBusinessDay(db, IST, () => new Date('2026-11-02T06:00:00Z'));
    const row = db.prepare("SELECT entity, entity_id, action, user_id FROM audit_event WHERE action = 'day.open'").get();
    expect(row).toEqual({ entity: 'business_day', entity_id: '2026-11-02', action: 'day.open', user_id: null });
  });

  it('keeps the open day across restarts, even after midnight', () => {
    ensureBusinessDay(db, IST, () => new Date('2026-11-02T06:00:00Z'));
    // Next morning, no DayEnd yet: the trading day has not changed (docs/00-overview.md).
    expect(ensureBusinessDay(db, IST, () => new Date('2026-11-03T06:00:00Z'))).toBe('2026-11-02');
    expect(db.prepare('SELECT count(*) FROM business_day').pluck().get()).toBe(1);
  });

  it('opens the next day when today was already closed by DayEnd', () => {
    ensureBusinessDay(db, IST, () => new Date('2026-11-02T06:00:00Z'));
    db.prepare("UPDATE business_day SET closed_at = '2026-11-02T17:00:00Z' WHERE date = '2026-11-02'").run();
    expect(ensureBusinessDay(db, IST, () => new Date('2026-11-02T18:00:00Z'))).toBe('2026-11-03');
  });

  it('opens today after an older day was closed', () => {
    db.prepare("INSERT INTO business_day (date, opened_at, closed_at) VALUES ('2026-10-30', 'x', 'y')").run();
    expect(ensureBusinessDay(db, IST, () => new Date('2026-11-02T06:00:00Z'))).toBe('2026-11-02');
  });
});

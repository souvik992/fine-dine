import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentBusinessDate } from '../core/business-day.js';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

type DayEndResult = { closedDate: string; nextDate: string; zReport: Record<string, unknown> & { byMode: unknown[]; byArea: unknown[]; byCategory: unknown[] } };

describe('DayEnd', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  beforeEach(() => seedOutlet(h));

  /** Opens, fires, bills and settles one table; returns the bill total. */
  function sale(tableId: string, tenders: (total: number) => unknown[]): number {
    const id = o.open(tableId, 2).order!.id;
    o.run('AddItems', id, { items: [line(S.dalMakhani, { qty: 2 }), line(S.virginMojito)] });
    o.run('FireKOT', id, { all: true });
    const { billId, totalPaise } = o.run('PrintBill', id, {}).result as { billId: string; totalPaise: number };
    o.run('Settle', id, { billId, tenders: tenders(totalPaise) });
    return totalPaise;
  }
  const dayEnd = (cash: number) => h.run('DayEnd', { cashCountedPaise: cash }).result as DayEndResult;

  // Acceptance: DayEnd blocked with open orders
  it('is refused while any order is open or billed, naming the tables', () => {
    o.open(S.t1);
    const err = h.fail('DayEnd', { cashCountedPaise: 0 }, 'INVALID_STATE');
    expect(err.message).toMatch(/still open \(T1\)/);
    expect(currentBusinessDate(h.db)).toBe('2026-11-02');
  });

  it('closes the day with a Z-report, opens the next date and prints the report', () => {
    const a = sale(S.t1, (t) => [{ mode: 'cash', amountPaise: t }]);
    const b = sale(S.t2, (t) => [{ mode: 'upi', amountPaise: t, ref: 'U1' }]);
    const r = dayEnd(a);
    expect(r).toMatchObject({ closedDate: '2026-11-02', nextDate: '2026-11-03' });
    expect(r.zReport).toMatchObject({
      bills: 2,
      covers: 4,
      kots: 4, // kitchen + bar per order
      netSalesPaise: a + b,
      cashExpectedPaise: a,
      cashCountedPaise: a,
      byMode: [
        { mode: 'cash', amountPaise: a },
        { mode: 'upi', amountPaise: b },
      ],
      byArea: [{ name: 'Main Hall', bills: 2, amountPaise: a + b }],
    });
    expect(r.zReport.byCategory).toEqual([
      { name: 'Main Course', qty: 4, amountPaise: 112_000 },
      { name: 'Mocktails', qty: 2, amountPaise: 44_000 },
    ]);
    expect(currentBusinessDate(h.db)).toBe('2026-11-03');
    expect(h.db.prepare("SELECT closed_at IS NOT NULL AS closed, z_report_json IS NOT NULL AS z FROM business_day WHERE date = '2026-11-02'").get()).toEqual({ closed: 1, z: 1 });
    expect(h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'zreport'").pluck().get()).toContain('Z REPORT');
    expect(h.count('event_log', "event = 'day.changed'")).toBe(1);
  });

  it('flags a cash difference for the leakage dashboard', () => {
    const a = sale(S.t1, (t) => [{ mode: 'cash', amountPaise: t }]);
    dayEnd(a - 5_000);
    expect(h.db.prepare("SELECT leakage_flag FROM audit_event WHERE action = 'day.close'").pluck().get()).toBe(1);
  });

  it('KOT and orders on the next date start fresh; bill numbers continue in the FY', () => {
    sale(S.t1, (t) => [{ mode: 'cash', amountPaise: t }]);
    dayEnd(0);
    const id = o.open(S.t1).order!.id;
    expect(h.db.prepare('SELECT business_date FROM "order" WHERE id = ?').pluck().get(id)).toBe('2026-11-03');
    o.run('AddItems', id, { items: [line(S.dalMakhani)] });
    expect((o.run('FireKOT', id, { all: true }).result as { kots: Array<{ kotNo: number }> }).kots[0]!.kotNo).toBe(1);
    expect((o.run('PrintBill', id, {}).result as { billNo: string }).billNo).toBe('B/26-27/000002');
  });

  it('prunes idempotency records older than 7 days', () => {
    h.db.prepare("INSERT INTO processed_command (command_id, type, result_json, at) VALUES ('old', 'X', '{}', '2026-10-01T00:00:00.000Z')").run();
    dayEnd(0);
    expect(h.count('processed_command', "command_id = 'old'")).toBe(0);
  });

  it('finished print jobs older than 30 days drop their ticket bytes (the record stays); recent or waiting ones are kept', () => {
    const job = (id: string, state: string, at: string) =>
      h.db.prepare("INSERT INTO print_job (id, printer_id, doc_kind, bytes, preview_text, state, created_at) VALUES (?, ?, 'kot', x'1b40414243', 'KOT', ?, ?)").run(id, S.kitchenPrinter, state, at);
    job('old-done', 'done', '2026-09-01T10:00:00.000Z');
    job('old-failed', 'failed', '2026-09-01T10:00:00.000Z');
    job('old-waiting', 'retry', '2026-09-01T10:00:00.000Z');
    job('recent', 'done', '2026-10-30T10:00:00.000Z');
    dayEnd(0);
    const bytes = (id: string) => h.db.prepare('SELECT length(bytes) FROM print_job WHERE id = ?').pluck().get(id);
    expect([bytes('old-done'), bytes('old-failed'), bytes('old-waiting'), bytes('recent')]).toEqual([0, 0, 5, 5]);
    expect(h.count('print_job', "id IN ('old-done', 'old-failed')")).toBe(2);
  });

  it('FORBIDDEN without the dayend right; DUPLICATE replay does not close twice', () => {
    h.fail('DayEnd', { cashCountedPaise: 0 }, 'FORBIDDEN', { rights: denyAll });
    const commandId = newId();
    h.run('DayEnd', { cashCountedPaise: 0 }, { commandId });
    expect(h.run('DayEnd', { cashCountedPaise: 0 }, { commandId }).duplicate).toBe(true);
    expect(h.count('business_day')).toBe(2);
  });
});

describe('SetConfig', () => {
  const h = useHarness();

  it('stores only changed keys, audits each, and validates values', () => {
    const r = h.run('SetConfig', { values: { 'outlet.name': 'Hotel Saffron', 'bill.prefix': 'HS' } }).result as { changed: string[] };
    expect(r.changed.sort()).toEqual(['bill.prefix', 'outlet.name']);
    expect((h.run('SetConfig', { values: { 'outlet.name': 'Hotel Saffron' } }).result as { changed: string[] }).changed).toEqual([]);
    expect(h.count('audit_event', "action = 'config.set'")).toBe(2);
    h.fail('SetConfig', { values: { 'bill.prefix': 'TOOLONG' } }, 'VALIDATION');
    h.fail('SetConfig', { values: { 'bill.roundOffStep': 25 } }, 'VALIDATION');
    h.fail('SetConfig', { values: { 'outlet.gstin': '27AAPFU0939F1ZX' } }, 'VALIDATION');
    h.fail('SetConfig', { values: { 'bill.printerId': newId() } }, 'NOT_FOUND');
    h.fail('SetConfig', { values: { nope: 1 } }, 'VALIDATION');
    h.fail('SetConfig', { values: { 'outlet.name': 'x' } }, 'FORBIDDEN', { rights: denyAll });
  });
});

import { newId, reportToCsv, type ReportTable } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedId } from '../seed/dev-seed.js';
import { useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { REPORTS, runReport } from './catalog.js';

// P4-03: each report on one realistic day, and the reports agree with each other and with the bills.
describe('reports v1', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  const DAY = '2026-11-02';
  let bills: Array<{ id: string; state: string; total_paise: number; subtotal_paise: number; cgst_paise: number; sgst_paise: number }>;

  const pay = (orderId: string, mode: 'cash' | 'upi') => {
    o.run('PrintBill', orderId, mode === 'cash' ? { discount: { kind: 'pct', value: 1000, reason: 'Regular guest' } } : {});
    const b = h.db.prepare("SELECT id, total_paise FROM bill WHERE order_id = ? AND state = 'printed'").get(orderId) as { id: string; total_paise: number };
    o.run('Settle', orderId, { billId: b.id, tenders: [{ mode, amountPaise: b.total_paise, ...(mode === 'upi' ? { ref: 'UPI-1' } : {}) }] });
  };

  beforeEach(() => {
    seedOutlet(h);
    // T1: dal ×2 + paneer tikka, 10% discount, cash.
    const t1 = o.open(S.t1, 2).order!.id;
    o.run('AddItems', t1, { items: [line(S.dalMakhani, { qty: 2 }), line(S.paneerTikka, { addons: [{ addonId: S.mild }] })] });
    o.run('FireKOT', t1, { all: true });
    pay(t1, 'cash');
    // T2: dal ×3 sent, reduced to 2, UPI; its KOT reprinted once.
    const t2 = o.open(S.t2, 4).order!.id;
    const dal = newId();
    o.run('AddItems', t2, { items: [line(S.dalMakhani, { id: dal, qty: 3 })] });
    const kotId = ((o.run('FireKOT', t2, { all: true }).result as { kots: Array<{ id: string }> }).kots[0]!).id;
    o.run('ModifyFiredItem', t2, { orderItemId: dal, newQty: 2, reason: 'Guest changed mind' });
    h.run('ReprintKOT', { kotId });
    pay(t2, 'upi');
    // T3: billed, then voided (guest left).
    const t3 = o.open(seedId('table:main:3'), 2).order!.id;
    o.run('AddItems', t3, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', t3, { all: true });
    o.run('PrintBill', t3, {});
    const b3 = h.db.prepare('SELECT id FROM bill WHERE order_id = ?').pluck().get(t3) as string;
    o.run('VoidBill', t3, { billId: b3, reason: 'Guest left' });
    h.run('PayIn', { amountPaise: 100_000, reason: 'Float' });
    bills = h.db.prepare('SELECT id, state, total_paise, subtotal_paise, cgst_paise, sgst_paise FROM bill').all() as typeof bills;
  });

  const run = (key: string): ReportTable => runReport(h.db, key, DAY, DAY, 'Asia/Kolkata');
  const settled = () => bills.filter((b) => b.state === 'settled');
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('lists 13 reports', () => {
    expect(REPORTS.map((r) => r.key)).toEqual(['daily', 'items', 'categories', 'areas', 'tables', 'gst', 'payments', 'cash', 'discounts', 'voids', 'kot-changes', 'captains', 'kitchen']);
  });

  it('daily sales: settled bills only; the void is counted apart', () => {
    const r = run('daily');
    const net = sum(settled().map((b) => b.total_paise));
    expect(r.rows).toEqual([expect.objectContaining({ day: DAY, bills: 2, covers: 6, net, voids: 1, voidAmount: bills.find((b) => b.state === 'void')!.total_paise })]);
    expect(r.summary.find((s) => s.label === 'Average bill')!.value).toBe(Math.round(net / 2));
  });

  it('items and categories add up to gross sales (before discount); a reduced line counts what is left', () => {
    const items = run('items');
    expect(items.totals!.amount).toBe(sum(settled().map((b) => b.subtotal_paise)));
    expect(items.rows.find((r) => r.item === 'Dal Makhani')).toMatchObject({ qty: 4, category: 'Main Course' });
    expect(run('categories').totals!.amount).toBe(items.totals!.amount);
  });

  it('GST by rate equals the bills’ CGST and SGST; payments equal net sales', () => {
    const g = run('gst');
    expect(g.rows).toEqual([expect.objectContaining({ rate: '5%', bills: 2 })]);
    expect(g.totals!.cgst).toBe(sum(settled().map((b) => b.cgst_paise)));
    expect(g.totals!.sgst).toBe(sum(settled().map((b) => b.sgst_paise)));
    const p = run('payments');
    expect(p.rows.map((r) => r.mode).sort()).toEqual(['Cash', 'UPI']);
    expect(p.totals!.amount).toBe(sum(settled().map((b) => b.total_paise)));
  });

  it('cash register: cash sales + paid in = expected; the day-end count gives the difference', () => {
    const cashSale = h.db.prepare("SELECT sum(amount_paise) FROM payment WHERE mode = 'cash'").pluck().get() as number;
    h.run('DayEnd', { cashCountedPaise: cashSale + 100_000 - 500 });
    const row = run('cash').rows[0]!;
    expect(row).toMatchObject({ day: DAY, cashSales: cashSale, payIn: 100_000, payOut: 0, expected: cashSale + 100_000, difference: -500 });
  });

  it('discounts, voids and KOT changes show who, why and how much', () => {
    expect(run('discounts').rows).toEqual([expect.objectContaining({ tbl: 'T1', reason: 'Regular guest', pct: '10.0%' })]);
    const v = run('voids');
    expect(v.rows.map((r) => [r.kind, r.what, r.qty, r.reason])).toEqual([
      ['Reduced after KOT', 'Dal Makhani', 1, 'Guest changed mind'],
      ['Void bill', 'B/26-27/000003', null, 'Guest left'],
    ]);
    const k = run('kot-changes');
    expect(k.rows.map((r) => r.kind)).toEqual(['Change slip (reduced)', 'KOT reprinted']);
    expect(k.rows[0]!.detail).toBe('Guest changed mind');
  });

  it('areas and table turnover', () => {
    expect(run('areas').rows).toEqual([expect.objectContaining({ area: 'Main Hall', bills: 2, covers: 6 })]);
    expect(run('tables').rows.map((r) => [r.tbl, r.turns, r.covers])).toEqual([
      ['T1', 1, 2],
      ['T2', 1, 4],
    ]);
  });

  it('captain performance (P3-04/05): per captain, paid orders only; adds up to net sales; no captain is listed last', () => {
    // T1 was Ravi's, T2 nobody's (set before payment would be refused, so set on the order rows directly).
    const ravi = seedId('user:captain');
    h.db.prepare(`UPDATE "order" SET captain_id = ? WHERE table_id = ?`).run(ravi, S.t1);
    const r = run('captains');
    const t1Net = bills.find((b) => b.state === 'settled' && h.db.prepare('SELECT o.table_id FROM bill b JOIN "order" o ON o.id = b.order_id WHERE b.id = ?').pluck().get(b.id) === S.t1)!.total_paise;
    expect(r.rows.map((x) => [x.captain, x.orders, x.covers, x.net, x.dishes, x.changes])).toEqual([
      ['Ravi (Captain)', 1, 2, t1Net, 3, 0],
      ['No captain', 1, 4, sum(settled().map((b) => b.total_paise)) - t1Net, 2, 1], // T2's dal reduced 3 → 2 with a change slip
    ]);
    expect(r.rows[0]!.perCover).toBe(Math.round(t1Net / 2));
    expect(r.totals).toMatchObject({ orders: 2, covers: 6, net: sum(settled().map((b) => b.total_paise)) });
    expect(r.summary[0]).toEqual({ label: 'Top: Ravi (Captain)', value: t1Net, type: 'money' });
  });

  it('refuses a wrong range or an unknown report; other days are empty', () => {
    expect(() => runReport(h.db, 'daily', '2026-11-05', '2026-11-01', 'Asia/Kolkata')).toThrow(/start date/);
    expect(() => runReport(h.db, 'daily', '2025-01-01', '2026-11-02', 'Asia/Kolkata')).toThrow(/one year/);
    expect(() => runReport(h.db, 'nope', DAY, DAY, 'Asia/Kolkata')).toThrow(/No such report/);
    expect(runReport(h.db, 'daily', '2026-10-01', '2026-10-31', 'Asia/Kolkata').rows).toEqual([]);
  });

  it('CSV: amounts as plain rupees, a TOTAL row, text guarded against spreadsheet formulas', () => {
    const t = run('discounts');
    t.rows[0]!.reason = '=HYPERLINK("x")';
    const { filename, csv } = reportToCsv(t);
    expect(filename).toBe('discounts_2026-11-02_to_2026-11-02.csv');
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('Bill,Date,Table,Gross,Discount,Share,Reason,Given by,Approved by');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[2]!.startsWith('TOTAL,')).toBe(true);
    expect(lines[1]).toMatch(/,\d+\.\d{2},\d+\.\d{2},10\.0%,/);
  });
});

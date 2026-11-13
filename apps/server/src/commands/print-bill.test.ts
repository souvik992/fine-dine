import { calculateBill, newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

type PrintResult = { billId: string; billNo: string; totalPaise: number; revision: number; printerId: string | null };

describe('PrintBill', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;

  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 4).order!.id;
    // Paneer Tikka 2 × ₹320, Dal Makhani ₹280, Butter Naan 3 × ₹60 + cheese ₹40 (all 5%)
    o.run('AddItems', orderId, {
      items: [line(S.paneerTikka, { qty: 2, addons: [{ addonId: S.mild }] }), line(S.dalMakhani), line(S.butterNaan, { qty: 3, addons: [{ addonId: S.cheese }] })],
    });
    o.run('FireKOT', orderId, { all: true });
  });

  const print = (payload: unknown = {}) => o.run('PrintBill', orderId, payload).result as PrintResult;
  const bill = (id: string) => h.db.prepare('SELECT * FROM bill WHERE id = ?').get(id) as Record<string, number | string | null>;

  // Acceptance: bill math incl. discount allocation and round-off
  it('stores totals identical to calculateBill, with discount and service charge', () => {
    const r = print({ discount: { kind: 'pct', value: 1000, reason: 'Regular guest' }, serviceCharge: { enabled: true } });
    const expected = calculateBill(
      [
        { id: 'a', qty: 2, unitPricePaise: 32_000, taxRateBp: 500 },
        { id: 'b', qty: 1, unitPricePaise: 28_000, taxRateBp: 500 },
        { id: 'c', qty: 3, unitPricePaise: 6_000, taxRateBp: 500, addons: [{ qty: 1, pricePaise: 4_000 }] },
      ],
      { discount: { kind: 'pct', valueBp: 1000 }, serviceChargeBp: 1000, roundOffStep: 100, roundOffTie: 'up' },
    );
    // 1,140 − 114 = 1,026; +102.60 service; 5% GST on 1,128.60 = 56.43 → 1,185.03 → round-off −0.03
    expect(expected.total).toBe(118_500);
    expect(r.totalPaise).toBe(expected.total);
    expect(bill(r.billId)).toMatchObject({
      subtotal_paise: expected.subtotal,
      discount_paise: 11_400,
      discount_reason: 'Regular guest',
      service_charge_paise: expected.serviceCharge,
      cgst_paise: expected.cgst,
      sgst_paise: expected.sgst,
      igst_paise: 0,
      round_off_paise: -3,
      total_paise: 118_500,
      state: 'printed',
    });
  });

  it('sends the sale up with its order type, items by category, tax and discount (the portal\'s Analytics page)', () => {
    const r = print({ discount: { kind: 'amount', value: 10_000, reason: 'Regular guest' } });
    const sent = JSON.parse(h.db.prepare("SELECT payload_json FROM outbox WHERE kind = 'bill.printed'").pluck().get() as string) as Record<string, unknown>;
    const b = bill(r.billId);
    expect(sent).toMatchObject({
      billId: r.billId,
      totalPaise: r.totalPaise,
      orderType: 'dine_in',
      channel: 'pos',
      terminal: null, // the test harness has no device; a terminal sends its name
      covers: 4,
      taxPaise: (b.cgst_paise as number) + (b.sgst_paise as number),
      discountPaise: 10_000,
    });
    const lines = sent.lines as Array<{ name: string; category: string | null; qty: number; amountPaise: number }>;
    expect(lines.map((l) => [l.qty, l.amountPaise])).toEqual([[2, 64_000], [1, 28_000], [3, 22_000]]); // naan 3 × ₹60 + cheese ₹40
    expect(lines.every((l) => typeof l.name === 'string' && typeof l.category === 'string')).toBe(true);
  });

  it('numbers bills B/<FY of the print date>/000001, 000002 …', () => {
    expect(print().billNo).toBe('B/26-27/000001');
    const second = o.open(S.t2).order!.id;
    o.run('AddItems', second, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', second, { all: true });
    expect((o.run('PrintBill', second, {}).result as PrintResult).billNo).toBe('B/26-27/000002');
  });

  it('marks the order billed and the table BILL_PRINTED', () => {
    const res = o.run('PrintBill', orderId, {});
    expect(res.order).toMatchObject({ state: 'billed', billPrintedAt: '2026-11-02T08:00:00.000Z', bills: [{ billNo: 1, billNoText: 'B/26-27/000001', state: 'printed' }] });
    expect(o.tableState(S.t1)).toBe('BILL_PRINTED');
  });

  it('queues the bill on the bill printer with the printed figures', () => {
    const r = print({ serviceCharge: { enabled: true }, customer: { name: 'Asha', phone: '98300 12345' } });
    const job = h.db.prepare("SELECT printer_id, preview_text FROM print_job WHERE doc_kind = 'bill'").get() as { printer_id: string; preview_text: string };
    expect(job.printer_id).toBe(r.printerId);
    expect(job.preview_text).toContain('Spice Garden (DEMO)');
    expect(job.preview_text).toContain('Bill: B/26-27/000001');
    expect(job.preview_text).toContain('Service charge @10%');
    expect(job.preview_text).toContain('Guest: Asha, 98300 12345');
    expect(job.preview_text).toContain('[UPI QR]');
  });

  it('keeps the printed document as revision 1', () => {
    const r = print();
    const doc = h.db.prepare('SELECT revision, bill_no_text, doc_json FROM bill_document WHERE bill_id = ?').get(r.billId) as { revision: number; bill_no_text: string; doc_json: string };
    expect(doc).toMatchObject({ revision: 1, bill_no_text: 'B/26-27/000001' });
    expect((JSON.parse(doc.doc_json) as { breakup: { total: number } }).breakup.total).toBe(r.totalPaise);
    expect(() => h.db.exec('DELETE FROM bill_document')).toThrow(/append-only/);
  });

  it('adding items after print supersedes the bill; printing again reuses the same number (revision 2)', () => {
    const first = print();
    o.run('AddItems', orderId, { items: [line(S.virginMojito)] });
    expect(bill(first.billId).state).toBe('superseded');
    o.run('FireKOT', orderId, { all: true });
    const again = print();
    expect(again).toMatchObject({ billId: first.billId, billNo: first.billNo, revision: 2 });
    expect(again.totalPaise).toBeGreaterThan(first.totalPaise);
    expect(h.count('bill')).toBe(1);
    expect(h.count('bill_document')).toBe(2);
    expect(h.db.prepare("SELECT value FROM counter WHERE name = 'bill_no:26-27'").pluck().get()).toBe(1);
  });

  it('INVALID_STATE with unsent items, nothing fired, or a bill already printed', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    expect(h.fail('PrintBill', {}, 'INVALID_STATE', { orderId, expectedVersion: 4 }).message).toMatch(/not sent to the kitchen/);
    const empty = o.open(S.t2).order!.id;
    h.fail('PrintBill', {}, 'INVALID_STATE', { orderId: empty, expectedVersion: 1 });
    o.run('RemoveHeldItem', orderId, { orderItemId: h.db.prepare("SELECT id FROM order_item WHERE status = 'held'").pluck().get() });
    print();
    h.fail('PrintBill', {}, 'INVALID_STATE', { orderId, expectedVersion: 6 });
  });

  it('VALIDATION for a discount without reason, over 100%, above the subtotal, or a bad GSTIN', () => {
    h.fail('PrintBill', { discount: { kind: 'pct', value: 500 } }, 'VALIDATION', { orderId, expectedVersion: 3 });
    h.fail('PrintBill', { discount: { kind: 'pct', value: 10_001, reason: 'x' } }, 'VALIDATION', { orderId, expectedVersion: 3 });
    h.fail('PrintBill', { discount: { kind: 'amount', value: 999_999, reason: 'x' } }, 'VALIDATION', { orderId, expectedVersion: 3 });
    h.fail('PrintBill', { customer: { gstin: '27AAPFU0939F1ZX' } }, 'VALIDATION', { orderId, expectedVersion: 3 });
  });

  it('a refused PrintBill does not use up a bill number (gap-free)', () => {
    h.fail('PrintBill', { discount: { kind: 'amount', value: 999_999, reason: 'x' } }, 'VALIDATION', { orderId, expectedVersion: 3 });
    expect(print().billNo).toBe('B/26-27/000001');
  });

  it('VERSION_CONFLICT, FORBIDDEN and DUPLICATE', () => {
    h.fail('PrintBill', {}, 'VERSION_CONFLICT', { orderId, expectedVersion: 2 });
    h.fail('PrintBill', {}, 'FORBIDDEN', { orderId, expectedVersion: 3, rights: denyAll });
    const commandId = newId();
    const first = o.run('PrintBill', orderId, {}, { commandId, expectedVersion: 3 });
    expect(o.run('PrintBill', orderId, {}, { commandId, expectedVersion: 3 })).toEqual({ ...first, duplicate: true });
    expect(h.count('bill')).toBe(1);
    expect(h.count('print_job', "doc_kind = 'bill'")).toBe(1);
  });
});

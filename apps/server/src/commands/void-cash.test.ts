import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOrderSnapshot } from '../queries/order-snapshot.js';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { buildZReport } from './day-end.js';

// P2-06 acceptance: void keeps the bill number; reports show VOID.
describe('VoidBill, PayIn, PayOut, OpenDrawer', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  let billId: string;
  let total: number;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 2).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { qty: 2 })] });
    o.run('FireKOT', orderId, { all: true });
    o.run('PrintBill', orderId, {});
    const b = h.db.prepare('SELECT id, total_paise FROM bill').get() as { id: string; total_paise: number };
    billId = b.id;
    total = b.total_paise;
  });

  const settle = (id = billId, amount = total) => o.run('Settle', orderId, { billId: id, tenders: [{ mode: 'cash', amountPaise: amount }] });
  const bill = (id = billId) => h.db.prepare('SELECT bill_no, state FROM bill WHERE id = ?').get(id) as { bill_no: number; state: string };
  const z = () => buildZReport(h.db, '2026-11-02', 0, 'X', 'now');

  it('voiding a settled bill keeps its number, reverses the payment, voids the order and prints a VOID copy', () => {
    settle();
    const res = o.run('VoidBill', orderId, { billId, reason: 'Billed to the wrong table' });
    expect(res.result).toMatchObject({ billId, billNo: 'B/26-27/000001', refundPaise: total, orderState: 'void' });
    expect(bill()).toEqual({ bill_no: 1, state: 'void' });
    expect(h.db.prepare('SELECT sum(amount_paise) FROM payment WHERE bill_id = ?').pluck().get(billId)).toBe(0);
    expect(h.db.prepare('SELECT count(*) FROM payment WHERE amount_paise < 0').pluck().get()).toBe(1); // a reversal row, nothing deleted
    expect(getOrderSnapshot(h.db, orderId)!.state).toBe('void');
    const printed = h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'bill' ORDER BY rowid DESC LIMIT 1").pluck().get() as string;
    expect(printed.split('\n')[0]).toContain('*** VOID ***');
    expect(printed).toContain('Reason: Billed to the wrong table');
    const audit = h.db.prepare("SELECT leakage_flag, reason FROM audit_event WHERE action = 'bill.void'").get();
    expect(audit).toEqual({ leakage_flag: 1, reason: 'Billed to the wrong table' });
  });

  it('the Z-report lists VOID bills by number and leaves them out of sales and cash', () => {
    settle();
    o.run('VoidBill', orderId, { billId, reason: 'Wrong table' });
    const r = z();
    expect(r.voids).toEqual([{ billNo: 'B/26-27/000001', amountPaise: total, reason: 'Wrong table' }]);
    expect(r.netSalesPaise).toBe(0);
    expect(r.cashExpectedPaise).toBe(0);
  });

  it('voiding an unpaid printed bill (guest left) voids the order and frees the table', () => {
    o.run('VoidBill', orderId, { billId, reason: 'Guest left without paying' });
    expect(getOrderSnapshot(h.db, orderId)!.state).toBe('void');
    expect(o.tableState(S.t1)).toBe('FREE');
  });

  it('voiding one part of a split leaves the other part payable and the table busy', () => {
    o.run('SplitBill', orderId, { mode: 'equal', parts: 2 });
    const [a, b] = h.db.prepare("SELECT id, total_paise FROM bill WHERE state = 'printed' ORDER BY bill_no").all() as Array<{ id: string; total_paise: number }>;
    o.run('VoidBill', orderId, { billId: a!.id, reason: 'Comped share' });
    expect(getOrderSnapshot(h.db, orderId)!.state).toBe('billed');
    expect(o.tableState(S.t1)).toBe('BILL_PRINTED');
    settle(b!.id, b!.total_paise);
    expect(getOrderSnapshot(h.db, orderId)!.state).toBe('settled');
  });

  it('refuses a void bill, a superseded one and a closed day; FORBIDDEN without bill.void', () => {
    const at = () => ({ orderId, expectedVersion: getOrderSnapshot(h.db, orderId)!.version });
    expect(h.fail('VoidBill', { billId, reason: 'x' }, 'FORBIDDEN', { ...at(), rights: denyAll }).details).toEqual({ right: 'bill.void' });
    h.fail('VoidBill', { billId: newId(), reason: 'x' }, 'NOT_FOUND', at());
    h.fail('VoidBill', { billId, reason: '' }, 'VALIDATION', at());
    h.db.prepare("UPDATE \"order\" SET business_date = '2026-11-01' WHERE id = ?").run(orderId);
    expect(h.fail('VoidBill', { billId, reason: 'x' }, 'INVALID_STATE', at()).message).toMatch(/closed day/);
    h.db.prepare("UPDATE \"order\" SET business_date = '2026-11-02' WHERE id = ?").run(orderId);
    o.run('VoidBill', orderId, { billId, reason: 'x' });
    h.fail('VoidBill', { billId, reason: 'again' }, 'INVALID_STATE', at());
  });

  it('pay-in and pay-out are recorded with a slip that opens the drawer, and change the cash expected', () => {
    settle();
    h.run('PayIn', { amountPaise: 200_000, reason: 'Opening float' });
    h.run('PayOut', { amountPaise: 45_000, reason: 'Milk from the market' });
    const r = z();
    expect(r.cashExpectedPaise).toBe(total + 200_000 - 45_000);
    expect(r).toMatchObject({ payInPaise: 200_000, payOutPaise: 45_000 });
    const slips = h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'drawer' ORDER BY rowid").pluck().all() as string[];
    expect(slips[0]).toContain('CASH PAID IN');
    expect(slips[1]).toContain('Reason: Milk from the market');
    expect(h.db.prepare("SELECT leakage_flag FROM audit_event WHERE action = 'cash.pay_out'").pluck().get()).toBe(1);
    expect(h.fail('PayOut', { amountPaise: 100, reason: 'x' }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'cash.move' });
    h.fail('PayIn', { amountPaise: 0, reason: 'x' }, 'VALIDATION');
  });

  it('OpenDrawer kicks the drawer on the bill printer with a reason, flagged; refused without a bill printer', () => {
    h.run('OpenDrawer', { reason: 'Change for a ₹2000 note' });
    expect(h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'drawer'").pluck().get()).toContain('DRAWER OPENED');
    expect(h.db.prepare("SELECT leakage_flag FROM audit_event WHERE action = 'drawer.open'").pluck().get()).toBe(1);
    h.db.prepare("UPDATE printer SET role = 'kot'").run();
    h.fail('OpenDrawer', { reason: 'x' }, 'INVALID_STATE');
    const commandId = newId();
    h.db.prepare("UPDATE printer SET role = 'both'").run();
    h.run('OpenDrawer', { reason: 'y' }, { commandId });
    expect(h.run('OpenDrawer', { reason: 'y' }, { commandId }).duplicate).toBe(true);
  });
});

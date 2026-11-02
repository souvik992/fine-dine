import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

describe('Settle', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  let billId: string;
  let total: number;

  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 2).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { qty: 3 })] }); // 840 + 42 GST = 882
    o.run('FireKOT', orderId, { all: true });
    const r = o.run('PrintBill', orderId, {}).result as { billId: string; totalPaise: number };
    billId = r.billId;
    total = r.totalPaise;
  });

  const settle = (tenders: unknown[], opts: { commandId?: string; expectedVersion?: number } = {}) => o.run('Settle', orderId, { billId, tenders }, opts);
  const payments = () => h.db.prepare('SELECT mode, amount_paise AS amount, ref FROM payment ORDER BY rowid').all();

  // Acceptance: table returns FREE after settle
  it('settles bill and order, frees the table', () => {
    expect(total).toBe(88_200);
    const res = settle([{ mode: 'upi', amountPaise: total, ref: 'UPI123' }]);
    expect(res.result).toEqual({ billId, paidPaise: total, changePaise: 0 });
    expect(res.order).toMatchObject({ state: 'settled', bills: [{ state: 'settled', paidPaise: total }] });
    expect(o.tableState(S.t1)).toBe('FREE');
    expect(h.db.prepare('SELECT open_order_id FROM dining_table WHERE id = ?').pluck().get(S.t1)).toBeNull();
    o.open(S.t1); // the table can be seated again
  });

  it('gives change from cash and records only what was kept', () => {
    const res = settle([{ mode: 'cash', amountPaise: 100_000 }]);
    expect(res.result).toMatchObject({ paidPaise: 100_000, changePaise: 11_800 });
    expect(payments()).toEqual([{ mode: 'cash', amount: total, ref: null }]);
  });

  it('splits across tenders: card part, cash rest with change', () => {
    settle([{ mode: 'card', amountPaise: 50_000, ref: 'slip 4411' }, { mode: 'cash', amountPaise: 50_000 }]);
    expect(payments()).toEqual([
      { mode: 'card', amount: 50_000, ref: 'slip 4411' },
      { mode: 'cash', amount: 38_200, ref: null },
    ]);
  });

  it('INVALID_STATE when short; VALIDATION when card/UPI exceed the bill', () => {
    expect(h.fail('Settle', { billId, tenders: [{ mode: 'cash', amountPaise: 80_000 }] }, 'INVALID_STATE', { orderId, expectedVersion: 4 }).message).toMatch(/still to be paid/);
    h.fail('Settle', { billId, tenders: [{ mode: 'card', amountPaise: 90_000, ref: null }] }, 'VALIDATION', { orderId, expectedVersion: 4 });
    expect(h.count('payment')).toBe(0);
  });

  it('due needs a guest name or phone; complimentary needs a reason and is flagged', () => {
    h.fail('Settle', { billId, tenders: [{ mode: 'due', amountPaise: total }] }, 'INVALID_STATE', { orderId, expectedVersion: 4 });
    h.fail('Settle', { billId, tenders: [{ mode: 'complimentary', amountPaise: total }] }, 'VALIDATION', { orderId, expectedVersion: 4 });
    settle([{ mode: 'complimentary', amountPaise: total, ref: 'Owner guest' }]);
    expect(h.db.prepare("SELECT leakage_flag, reason FROM audit_event WHERE action = 'bill.settle'").get()).toEqual({ leakage_flag: 1, reason: 'Owner guest' });
  });

  it('INVALID_STATE for a superseded bill; NOT_FOUND for a bill of another order', () => {
    o.run('AddItems', orderId, { items: [line(S.butterNaan)] });
    expect(h.fail('Settle', { billId, tenders: [{ mode: 'cash', amountPaise: total }] }, 'INVALID_STATE', { orderId, expectedVersion: 5 }).message).toMatch(/print the bill again/);
    h.fail('Settle', { billId: newId(), tenders: [{ mode: 'cash', amountPaise: 1 }] }, 'NOT_FOUND', { orderId, expectedVersion: 5 });
  });

  it('settled bills and payments cannot be edited in the database (append-only triggers)', () => {
    settle([{ mode: 'cash', amountPaise: total }]);
    expect(() => h.db.prepare('UPDATE bill SET total_paise = 1 WHERE id = ?').run(billId)).toThrow(/settled bill/);
    expect(() => h.db.exec('UPDATE payment SET amount_paise = 1')).toThrow(/append-only/);
    expect(() => h.db.exec('DELETE FROM payment')).toThrow(/append-only/);
    expect(() => h.db.exec('DELETE FROM bill')).toThrow(/never deleted/);
  });

  it('VERSION_CONFLICT, FORBIDDEN and DUPLICATE (no double payment)', () => {
    h.fail('Settle', { billId, tenders: [{ mode: 'cash', amountPaise: total }] }, 'VERSION_CONFLICT', { orderId, expectedVersion: 3 });
    h.fail('Settle', { billId, tenders: [{ mode: 'cash', amountPaise: total }] }, 'FORBIDDEN', { orderId, expectedVersion: 4, rights: denyAll });
    const commandId = newId();
    settle([{ mode: 'cash', amountPaise: total }], { commandId, expectedVersion: 4 });
    expect(settle([{ mode: 'cash', amountPaise: total }], { commandId, expectedVersion: 4 }).duplicate).toBe(true);
    expect(h.count('payment')).toBe(1);
  });
});

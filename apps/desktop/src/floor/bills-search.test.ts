import type { DayBill } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { billMatches } from './bills-search.js';

const bill = (over: Partial<DayBill> = {}): DayBill => ({
  billId: 'b1', billNo: 'B/25-26/0042', orderId: 'o1', orderVersion: 1, orderState: 'SETTLED', table: 'T7', partNo: 1, parts: 1,
  totalPaise: 125_000, state: 'settled', payments: [{ mode: 'upi', amountPaise: 125_000 }], printedAt: null, ...over,
});

describe('billMatches', () => {
  it('matches everything on an empty search', () => expect(billMatches(bill(), '  ')).toBe(true));
  it('finds by bill number, table, mode and status, ignoring case', () => {
    for (const q of ['0042', 't7', 'UPI', 'paid']) expect(billMatches(bill(), q)).toBe(true);
    expect(billMatches(bill(), 'cash')).toBe(false);
    expect(billMatches(bill({ state: 'printed' }), 'unpaid')).toBe(true);
  });
  it('finds by amount in rupees, with or without commas', () => {
    for (const q of ['1250', '1,250', '₹1,250.00']) expect(billMatches(bill(), q)).toBe(true);
    expect(billMatches(bill(), '999')).toBe(false);
  });
});

import { checkBillInvariants, newId, type BillBreakup } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getOrderSnapshot } from '../queries/order-snapshot.js';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

interface BillRow {
  id: string;
  bill_no: number;
  split_no: number;
  split_of: number;
  total_paise: number;
  state: string;
}

describe('SplitBill', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  let naan: string;
  let dal: string;
  let firstTotal: number;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 3).order!.id;
    naan = newId();
    dal = newId();
    o.run('AddItems', orderId, { items: [line(S.butterNaan, { id: naan, qty: 3 }), line(S.dalMakhani, { id: dal, qty: 2 })] });
    o.run('FireKOT', orderId, { all: true });
    firstTotal = (o.run('PrintBill', orderId, { discount: { kind: 'pct', value: 1000, reason: 'Regular' }, serviceCharge: { enabled: true } }).result as { totalPaise: number }).totalPaise;
  });

  const bills = () => h.db.prepare('SELECT id, bill_no, split_no, split_of, total_paise, state FROM bill ORDER BY bill_no').all() as BillRow[];
  const live = () => bills().filter((b) => b.state === 'printed' || b.state === 'settled');
  const docOf = (id: string) => JSON.parse(h.db.prepare('SELECT doc_json FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').pluck().get(id) as string) as { breakup: BillBreakup; part: { no: number; of: number } };

  it('equal: the printed bill keeps its number as Part 1, new parts take the next numbers; parts add up and are rounded', () => {
    const first = bills()[0]!;
    const res = o.run('SplitBill', orderId, { mode: 'equal', parts: 3 }).result as { bills: Array<{ billNo: string; totalPaise: number }> };
    expect(res.bills.map((b) => b.billNo)).toEqual(['B/26-27/000001', 'B/26-27/000002', 'B/26-27/000003']);
    const rows = live();
    expect(rows[0]!.id).toBe(first.id);
    expect(rows.map((b) => b.split_of)).toEqual([3, 3, 3]);
    expect(rows.reduce((s, b) => s + b.total_paise, 0)).toBe(firstTotal);
    for (const b of rows) {
      expect(b.total_paise % 100).toBe(0);
      expect(checkBillInvariants(docOf(b.id).breakup)).toEqual([]);
    }
    expect(docOf(rows[1]!.id).part).toEqual({ no: 2, of: 3 });
    const printed = h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'bill' ORDER BY rowid DESC LIMIT 1").pluck().get() as string;
    expect(printed).toContain('Part 3 of 3');
    expect(printed).toMatch(/1\/3 of /);
  });

  it('by item, sharing a line by quantity; every line must be assigned exactly once', () => {
    const at = () => ({ orderId, expectedVersion: getOrderSnapshot(h.db, orderId)!.version });
    h.fail('SplitBill', { mode: 'items', parts: [{ items: [{ orderItemId: naan, qty: 3 }] }, { items: [{ orderItemId: dal, qty: 1 }] }] }, 'VALIDATION', at());
    h.fail('SplitBill', { mode: 'items', parts: [{ items: [{ orderItemId: newId(), qty: 1 }] }, { items: [{ orderItemId: dal, qty: 2 }] }] }, 'NOT_FOUND', at());
    o.run('SplitBill', orderId, {
      mode: 'items',
      parts: [{ items: [{ orderItemId: naan, qty: 2 }] }, { items: [{ orderItemId: naan, qty: 1 }, { orderItemId: dal, qty: 2 }] }],
    });
    const rows = live();
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, b) => s + b.total_paise, 0)).toBe(firstTotal);
    expect(docOf(rows[1]!.id).breakup.lines.map((l) => l.id)).toEqual([naan, dal]);
  });

  it('proportion 2 : 1', () => {
    o.run('SplitBill', orderId, { mode: 'proportion', parts: [{ weight: 2 }, { weight: 1 }] });
    const [a, b] = live();
    expect(a!.total_paise + b!.total_paise).toBe(firstTotal);
    expect(Math.abs(a!.total_paise - 2 * b!.total_paise)).toBeLessThanOrEqual(300);
  });

  it('re-splitting reuses numbers in order and voids a part no longer needed (numbers stay gap-free)', () => {
    o.run('SplitBill', orderId, { mode: 'equal', parts: 3 });
    o.run('SplitBill', orderId, { mode: 'equal', parts: 2 });
    expect(bills().map((b) => [b.bill_no, b.state])).toEqual([
      [1, 'printed'],
      [2, 'printed'],
      [3, 'void'],
    ]);
    expect(live().reduce((s, b) => s + b.total_paise, 0)).toBe(firstTotal);
  });

  it('paying one part keeps the table busy; paying the last frees it; a paid split cannot change', () => {
    o.run('SplitBill', orderId, { mode: 'equal', parts: 2 });
    const [a, b] = live();
    o.run('Settle', orderId, { billId: a!.id, tenders: [{ mode: 'cash', amountPaise: a!.total_paise }] });
    expect(getOrderSnapshot(h.db, orderId)!.state).toBe('billed');
    expect(o.tableState(S.t1)).toBe('BILL_PRINTED');
    const at = () => ({ orderId, expectedVersion: getOrderSnapshot(h.db, orderId)!.version });
    h.fail('SplitBill', { mode: 'equal', parts: 3 }, 'INVALID_STATE', at());
    h.fail('AddItems', { items: [line(S.dalMakhani)] }, 'INVALID_STATE', at());
    o.run('Settle', orderId, { billId: b!.id, tenders: [{ mode: 'upi', amountPaise: b!.total_paise, ref: 'UPI-1' }] });
    expect(getOrderSnapshot(h.db, orderId)!.state).toBe('settled');
    expect(o.tableState(S.t1)).toBe('FREE');
  });

  it('adding items after a split: the bill prints whole again under Part 1’s number; other parts are voided', () => {
    o.run('SplitBill', orderId, { mode: 'equal', parts: 3 });
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    o.run('PrintBill', orderId, {});
    expect(bills().map((b) => [b.bill_no, b.state, b.split_of])).toEqual([
      [1, 'printed', 1],
      [2, 'void', 3],
      [3, 'void', 3],
    ]);
  });

  it('refused before the bill is printed; FORBIDDEN without bill.split; VERSION_CONFLICT; replay', () => {
    const other = o.open(S.t2, 2).order!.id;
    o.run('AddItems', other, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', other, { all: true });
    expect(h.fail('SplitBill', { mode: 'equal', parts: 2 }, 'INVALID_STATE', { orderId: other, expectedVersion: 3 }).message).toMatch(/Print the bill first/);
    const v = getOrderSnapshot(h.db, orderId)!.version;
    expect(h.fail('SplitBill', { mode: 'equal', parts: 2 }, 'FORBIDDEN', { orderId, expectedVersion: v, rights: denyAll }).details).toEqual({ right: 'bill.split' });
    h.fail('SplitBill', { mode: 'equal', parts: 2 }, 'VERSION_CONFLICT', { orderId, expectedVersion: v - 1 });
    const commandId = newId();
    o.run('SplitBill', orderId, { mode: 'equal', parts: 2 }, { commandId });
    expect(o.run('SplitBill', orderId, { mode: 'equal', parts: 2 }, { commandId, expectedVersion: v }).duplicate).toBe(true);
    expect(live()).toHaveLength(2);
    h.fail('SplitBill', { mode: 'equal', parts: 1 }, 'VALIDATION', { orderId, expectedVersion: v + 1 });
  });
});

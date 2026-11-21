import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFloor } from '../queries/floor.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

describe('OpenCounterOrder (takeaway and delivery from the floor)', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  beforeEach(() => seedOutlet(h));

  const floor = () => getFloor(h.db, TEST_NOW(), 'Asia/Kolkata');
  const takeaway = (extra: Record<string, unknown> = {}) => h.run('OpenCounterOrder', { type: 'takeaway', ...extra });
  const delivery = (extra: Record<string, unknown> = {}) =>
    h.run('OpenCounterOrder', {
      type: 'delivery',
      customerName: 'Ravi',
      customerPhone: '98300 12345',
      address: '12 Park Street, Kolkata',
      ...extra,
    });

  it('opens a takeaway with no table and a ticket number for the day', () => {
    const res = takeaway({ customerName: 'Asha' });
    expect(res.order).toMatchObject({
      type: 'takeaway',
      state: 'open',
      version: 1,
      ticketNo: 1,
      customer: { name: 'Asha' },
      covers: 0,
    });
    expect(res.order?.table).toBeUndefined();
    expect(res.result).toEqual({ orderId: res.order!.id, ticketNo: 1 });
    expect(h.count('dining_table', 'open_order_id IS NOT NULL')).toBe(0);
    expect(h.count('event_log', "event = 'counter.changed'")).toBe(1);
  });

  it('takeaway and delivery share one ticket sequence', () => {
    expect(takeaway().order?.ticketNo).toBe(1);
    expect(delivery().order?.ticketNo).toBe(2);
    expect(takeaway().order?.ticketNo).toBe(3);
  });

  it('a delivery keeps the phone and address; it needs both', () => {
    expect(delivery().order).toMatchObject({
      type: 'delivery',
      customer: {
        name: 'Ravi',
        phone: '98300 12345',
        address: '12 Park Street, Kolkata',
      },
    });
    h.fail('OpenCounterOrder', { type: 'delivery', customerPhone: '98300 12345' }, 'VALIDATION');
    h.fail('OpenCounterOrder', { type: 'delivery', address: 'Somewhere' }, 'VALIDATION');
    h.fail('OpenCounterOrder', { type: 'delivery', customerPhone: 'call me', address: 'Somewhere' }, 'VALIDATION');
  });

  it('a takeaway ignores an address and blank names', () => {
    expect(takeaway({ customerName: '  ', address: 'x' }).order?.customer).toBeUndefined();
  });

  it('shows on the floor beside the tables until settled', () => {
    const orderId = delivery().order!.id;
    expect(floor().counterOrders).toMatchObject([
      {
        orderId,
        type: 'delivery',
        ticketNo: 1,
        stage: 'new',
        customerName: 'Ravi',
        itemCount: 0,
        amountPaise: 0,
      },
    ]);

    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { qty: 2 })] });
    o.run('FireKOT', orderId, { all: true });
    expect(floor().counterOrders?.[0]).toMatchObject({
      stage: 'kitchen',
      itemCount: 2,
      amountPaise: 58_800,
    });

    // the kitchen ticket says which order it is and for whom
    const kot = h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'kot'").pluck().get() as string;
    expect(kot).toMatch(/DELIVERY/);
    expect(kot).toMatch(/#1 - Ravi/);

    const bill = o.run('PrintBill', orderId, {}).result as {
      billId: string;
      totalPaise: number;
    };
    expect(floor().counterOrders?.[0]?.stage).toBe('billed');
    const printed = h.db.prepare("SELECT preview_text FROM print_job WHERE doc_kind = 'bill'").pluck().get() as string;
    expect(printed).toMatch(/Delivery #1/);
    expect(printed).toMatch(/Guest: Ravi, 98300 12345/);
    expect(printed).toMatch(/Deliver to: 12 Park Street, Kolkata/);

    o.run('Settle', orderId, {
      billId: bill.billId,
      tenders: [{ mode: 'cash', amountPaise: bill.totalPaise }],
    });
    expect(floor().counterOrders).toEqual([]);
  });

  it('cancels with ReleaseTable while nothing was sent', () => {
    const orderId = takeaway().order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('ReleaseTable', orderId, { reason: 'Customer left' });
    expect(h.db.prepare('SELECT state FROM "order" WHERE id = ?').pluck().get(orderId)).toBe('void');
    expect(floor().counterOrders).toEqual([]);
  });

  it('accepts a client-made id once; FORBIDDEN without order.create', () => {
    const orderId = newId();
    expect(takeaway({ orderId }).order?.id).toBe(orderId);
    h.fail('OpenCounterOrder', { type: 'takeaway', orderId }, 'INVALID_STATE');
    h.fail('OpenCounterOrder', { type: 'takeaway' }, 'FORBIDDEN', {
      rights: denyAll,
    });
  });

  it('VALIDATION for a dine-in type', () => {
    h.fail('OpenCounterOrder', { type: 'dine_in' }, 'VALIDATION');
  });
});

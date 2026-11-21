import type { CounterOrder } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { cleanPhone, counterFormError, counterOrdersOf, isCounterOrder, orderTitle } from './counter-model.js';

const order = (type: CounterOrder['type'], ticketNo: number): CounterOrder => ({
  orderId: `o${ticketNo}`,
  orderVersion: 1,
  type,
  ticketNo,
  stage: 'new',
  since: '2026-11-02T08:00:00Z',
  elapsedMin: 0,
  amountPaise: 0,
  itemCount: 0,
});

describe('counter orders (takeaway and delivery)', () => {
  it('names orders by table or ticket', () => {
    expect(
      orderTitle({
        type: 'dine_in',
        table: { id: 't', label: 'T7', areaId: 'a' },
      }),
    ).toBe('Table T7');
    expect(orderTitle({ type: 'takeaway', ticketNo: 12 })).toBe('Takeaway #12');
    expect(orderTitle({ type: 'delivery', ticketNo: 5 })).toBe('Delivery #5');
    expect(orderTitle({ type: 'takeaway' })).toBe('Takeaway');
    expect(orderTitle({ type: 'online' })).toBe('Online order');
  });

  it('knows a counter order from a table or online order', () => {
    expect(isCounterOrder({ type: 'takeaway' })).toBe(true);
    expect(isCounterOrder({ type: 'delivery' })).toBe(true);
    expect(isCounterOrder({ type: 'online' })).toBe(false);
    expect(
      isCounterOrder({
        type: 'dine_in',
        table: { id: 't', label: 'T1', areaId: 'a' },
      }),
    ).toBe(false);
  });

  it('a delivery needs a phone and an address; a takeaway needs nothing', () => {
    expect(counterFormError('takeaway', { phone: '', address: '' })).toBeNull();
    expect(counterFormError('delivery', { phone: '', address: 'x' })).toMatch(/phone/);
    expect(counterFormError('delivery', { phone: '123', address: 'x' })).toMatch(/phone/);
    expect(counterFormError('takeaway', { phone: '12', address: '' })).toMatch(/phone/);
    expect(counterFormError('delivery', { phone: '98300 12345', address: '  ' })).toMatch(/address/);
    expect(
      counterFormError('delivery', {
        phone: '98300 12345',
        address: '12 Park Street',
      }),
    ).toBeNull();
  });

  it('keeps only what a phone number can hold', () => {
    expect(cleanPhone('+91 98300-12345 ext')).toBe('+91 98300-12345 ');
    expect(cleanPhone('1'.repeat(30))).toHaveLength(17);
  });

  it('filters by type', () => {
    const list = [order('takeaway', 1), order('delivery', 2), order('takeaway', 3)];
    expect(counterOrdersOf(list, 'all')).toHaveLength(3);
    expect(counterOrdersOf(list, 'delivery').map((o) => o.ticketNo)).toEqual([2]);
    expect(counterOrdersOf(undefined, 'all')).toEqual([]);
  });
});

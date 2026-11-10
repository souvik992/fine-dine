import type { HubOrderState, OnlineOrderView } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { autoAcceptedSince, board, chimeUpdate, lateOrders, nextSteps, prepClock, timeLeft, waitingCount } from './online-model.js';

const o = (id: string, state: HubOrderState, receivedAt: string, fulfilment: 'PICKUP' | 'DELIVERY' = 'PICKUP') =>
  ({ id, state, receivedAt, order: { fulfilment } }) as unknown as OnlineOrderView;

describe('online orders screen', () => {
  it('sorts orders into New, Kitchen, Ready, Out and Done; oldest first, done newest first', () => {
    const b = board([o('a', 'RECEIVED', '2'), o('b', 'SENT_TO_STORE', '1'), o('c', 'PREPARING', '3'), o('d', 'READY', '4'), o('e', 'OUT_FOR_DELIVERY', '5'), o('f', 'DELIVERED', '6'), o('g', 'CANCELLED', '7')]);
    expect(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map((x) => x.id)]))).toEqual({ new: ['b', 'a'], kitchen: ['c'], ready: ['d'], out: ['e'], done: ['g', 'f'] });
    expect(waitingCount([o('a', 'RECEIVED', '1'), o('b', 'SENT_TO_STORE', '1'), o('c', 'ACCEPTED', '1')])).toBe(2);
  });

  it('an order first seen already accepted was accepted automatically; the first load reports none', () => {
    const list = [o('a', 'ACCEPTED', '1'), o('b', 'RECEIVED', '1')];
    expect(autoAcceptedSince(null, list)).toEqual([]);
    expect(autoAcceptedSince(new Set(['a']), [...list, o('c', 'ACCEPTED', '2'), o('d', 'REJECTED', '2')])).toEqual(['c']);
    expect(autoAcceptedSince(new Set(['b']), [o('b', 'ACCEPTED', '1')])).toEqual([]);
  });

  it('chime: rings while an order waits (also one already waiting at start), stops once accepted; one chime for an order accepted automatically', () => {
    // app starts with an order already waiting: it rings, and no automatic-accept chime on the first load
    const start = chimeUpdate(null, [o('a', 'RECEIVED', '1'), o('b', 'ACCEPTED', '1')]);
    expect([start.ringing, start.chimeOnce]).toEqual([true, false]);
    // staff accept it: the ringing stops
    const accepted = chimeUpdate(start.seen, [o('a', 'ACCEPTED', '1'), o('b', 'ACCEPTED', '1')]);
    expect([accepted.ringing, accepted.chimeOnce]).toEqual([false, false]);
    // a new order accepted automatically: one chime, no ringing
    const auto = chimeUpdate(accepted.seen, [o('a', 'ACCEPTED', '1'), o('b', 'ACCEPTED', '1'), o('c', 'ACCEPTED', '2')]);
    expect([auto.ringing, auto.chimeOnce]).toEqual([false, true]);
    // the next update of the same list does not chime again
    expect(chimeUpdate(auto.seen, [o('c', 'ACCEPTED', '2')]).chimeOnce).toBe(false);
    // a new waiting order rings again
    expect(chimeUpdate(auto.seen, [o('c', 'ACCEPTED', '2'), o('d', 'SENT_TO_STORE', '3')]).ringing).toBe(true);
  });

  it('next steps follow the contract: pickup ends collected, delivery goes out with a rider', () => {
    expect(nextSteps(o('a', 'ACCEPTED', '1'))).toEqual(['PREPARING', 'READY']);
    expect(nextSteps(o('a', 'READY', '1', 'PICKUP'))).toEqual(['PICKED_UP']);
    expect(nextSteps(o('a', 'READY', '1', 'DELIVERY'))).toEqual(['OUT_FOR_DELIVERY']);
    expect(nextSteps(o('a', 'OUT_FOR_DELIVERY', '1', 'DELIVERY'))).toEqual(['DELIVERED']);
    expect(nextSteps(o('a', 'CANCELLED', '1'))).toEqual([]);
  });

  it('preparation clock: counts down to the ready time, warns in the last 2 minutes, then says how late; late orders', () => {
    const eta = 1_000_000;
    expect(prepClock('ACCEPTED', eta, eta - 15 * 60_000)).toEqual({ text: 'Ready in 15:00', soon: false, late: false });
    expect(prepClock('PREPARING', eta, eta - 61_500)).toEqual({ text: 'Ready in 1:02', soon: true, late: false });
    expect(prepClock('PREPARING', eta, eta)).toEqual({ text: 'Late by 1 min', soon: false, late: true });
    expect(prepClock('ACCEPTED', eta, eta + 3 * 60_000 + 1)).toEqual({ text: 'Late by 4 min', soon: false, late: true });
    expect(prepClock('READY', eta, eta + 60_000)).toBeNull();
    expect(prepClock('ACCEPTED', null, eta)).toBeNull();
    const at = (id: string, state: HubOrderState, etaAt: number | null) => ({ id, state, receivedAt: '1', order: { etaAt } }) as unknown as OnlineOrderView;
    expect(lateOrders([at('a', 'ACCEPTED', 4000), at('b', 'PREPARING', 6000), at('c', 'READY', 1000), at('d', 'ACCEPTED', null)], 5000).map((x) => x.id)).toEqual(['a']);
  });

  it('time left before the hub rejects an unanswered order', () => {
    expect(timeLeft(10_000 + 272_000, 10_000)).toEqual({ text: '4:32 left', urgent: false });
    expect(timeLeft(10_000 + 30_000, 10_000)).toEqual({ text: '0:30 left', urgent: true });
    expect(timeLeft(null, 0)).toBeNull();
  });
});

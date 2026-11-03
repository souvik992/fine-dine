import type { HubOrderState, OnlineOrderView } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { board, nextSteps, timeLeft, waitingCount } from './online-model.js';

const o = (id: string, state: HubOrderState, receivedAt: string, fulfilment: 'PICKUP' | 'DELIVERY' = 'PICKUP') =>
  ({ id, state, receivedAt, order: { fulfilment } }) as unknown as OnlineOrderView;

describe('online orders screen', () => {
  it('sorts orders into New, Kitchen, Ready, Out and Done; oldest first, done newest first', () => {
    const b = board([o('a', 'RECEIVED', '2'), o('b', 'SENT_TO_STORE', '1'), o('c', 'PREPARING', '3'), o('d', 'READY', '4'), o('e', 'OUT_FOR_DELIVERY', '5'), o('f', 'DELIVERED', '6'), o('g', 'CANCELLED', '7')]);
    expect(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.map((x) => x.id)]))).toEqual({ new: ['b', 'a'], kitchen: ['c'], ready: ['d'], out: ['e'], done: ['g', 'f'] });
    expect(waitingCount([o('a', 'RECEIVED', '1'), o('b', 'SENT_TO_STORE', '1'), o('c', 'ACCEPTED', '1')])).toBe(2);
  });

  it('next steps follow the contract: pickup ends collected, delivery goes out with a rider', () => {
    expect(nextSteps(o('a', 'ACCEPTED', '1'))).toEqual(['PREPARING', 'READY']);
    expect(nextSteps(o('a', 'READY', '1', 'PICKUP'))).toEqual(['PICKED_UP']);
    expect(nextSteps(o('a', 'READY', '1', 'DELIVERY'))).toEqual(['OUT_FOR_DELIVERY']);
    expect(nextSteps(o('a', 'OUT_FOR_DELIVERY', '1', 'DELIVERY'))).toEqual(['DELIVERED']);
    expect(nextSteps(o('a', 'CANCELLED', '1'))).toEqual([]);
  });

  it('time left before the hub rejects an unanswered order', () => {
    expect(timeLeft(10_000 + 272_000, 10_000)).toEqual({ text: '4:32 left', urgent: false });
    expect(timeLeft(10_000 + 30_000, 10_000)).toEqual({ text: '0:30 left', urgent: true });
    expect(timeLeft(null, 0)).toBeNull();
  });
});

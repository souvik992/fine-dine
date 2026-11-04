import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_NOW, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';
import { getFloor } from './floor.js';

// The floor shows what the kitchen screens say about each table's food: cooking (how long), ready to serve.
describe('kitchen status on the floor', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  let kitchenKot: string;
  beforeEach(() => {
    seedOutlet(h);
    h.db.prepare('UPDATE station SET has_kds = CASE id WHEN ? THEN 1 ELSE 0 END').run(S.kitchen); // the Tandoor still prints only
    orderId = o.open(S.t1, 2).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani), line(S.butterNaan)] });
    const kots = (o.run('FireKOT', orderId, { all: true }).result as { kots: Array<{ id: string; stationId: string }> }).kots;
    kitchenKot = kots.find((k) => k.stationId === S.kitchen)!.id;
  });
  const t1 = (at = TEST_NOW()) => getFloor(h.db, at, 'Asia/Kolkata').tables.find((t) => t.id === S.t1)!;
  const plus = (min: number) => new Date(TEST_NOW().getTime() + min * 60_000);

  it('a ticket at a station with a screen is cooking, then ready to serve, then gone once served; paper-only stations are left out', () => {
    expect(t1().kitchen).toEqual({ cooking: 1, ready: 0, cookingSince: TEST_NOW().toISOString(), waitingMin: 0, level: 'ok', amberMin: 10, redMin: 20 }); // the Tandoor ticket is not counted
    h.run('MarkKotReady', { kotId: kitchenKot });
    expect(t1().kitchen).toMatchObject({ cooking: 0, ready: 1, cookingSince: null, waitingMin: null, level: 'ok' });
    h.run('MarkKotServed', { kotId: kitchenKot });
    expect(t1().kitchen).toBeUndefined();
    expect(getFloor(h.db, TEST_NOW(), 'Asia/Kolkata').tables.find((t) => t.id === S.t2)!.kitchen).toBeUndefined(); // a free table
  });

  it('the wait turns amber and red at the kitchen screen’s own limits (10 and 20 minutes by default)', () => {
    expect(t1(plus(9)).kitchen).toMatchObject({ waitingMin: 9, level: 'ok' });
    expect(t1(plus(12)).kitchen).toMatchObject({ waitingMin: 12, level: 'amber' });
    expect(t1(plus(25)).kitchen).toMatchObject({ waitingMin: 25, level: 'red' });
  });

  it('a ticket whose food was all cancelled is no longer counted', () => {
    const itemId = h.db.prepare('SELECT id FROM order_item WHERE kot_id = ?').pluck().get(kitchenKot) as string;
    o.run('CancelFiredItem', orderId, { orderItemId: itemId, reason: 'Guest changed mind', returnToStock: false });
    expect(t1().kitchen).toBeUndefined();
  });

  it('a station not marked for a screen counts once a ticket there was bumped on one (in the last 7 business days)', () => {
    const tandoorKot = h.db.prepare('SELECT id FROM kot WHERE station_id = ? AND order_id = ?').pluck().get(S.tandoor, orderId) as string;
    h.run('MarkKotReady', { kotId: tandoorKot });
    expect(t1().kitchen).toMatchObject({ cooking: 1, ready: 1 }); // the kitchen still cooking, the tandoor ready
    expect(t1(new Date(TEST_NOW().getTime() + 8 * 86_400_000)).kitchen).toMatchObject({ cooking: 1, ready: 0 }); // that bump is old news a week on
  });

  it('a bump on a kitchen screen tells the floor (every terminal redraws the tile)', () => {
    h.run('MarkKotReady', { kotId: kitchenKot });
    expect(h.count('event_log', "event = 'kot.status' AND topic = 'floor'")).toBe(1);
  });
});

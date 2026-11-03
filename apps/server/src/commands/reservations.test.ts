import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFloor } from '../queries/floor.js';
import { getReservationDay, getWaitlist } from '../queries/reservations.js';
import { seedId } from '../seed/dev-seed.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { S, seedOutlet } from '../testing/order-fixture.js';

// P4-04: bookings hold their tables; the waitlist seats walk-ins. Test clock: 2026-11-02 13:30 IST (08:00Z).
const at = (hhmm: string) => `2026-11-02T${hhmm}:00+05:30`;
const T3 = seedId('table:main:3');

describe('bookings', () => {
  const h = useHarness();
  beforeEach(() => seedOutlet(h));
  const book = (extra: Record<string, unknown> = {}) =>
    (h.run('CreateReservation', { guestName: 'Sharma', phone: '98300 12345', partySize: 4, startsAt: at('14:00'), tableIds: [S.t1], ...extra }).result as { reservationId: string }).reservationId;
  const table = (id: string, now = TEST_NOW()) => getFloor(h.db, now, 'Asia/Kolkata').tables.find((t) => t.id === id)!;
  const day = (now = TEST_NOW()) => getReservationDay(h.db, '2026-11-02', now, 'Asia/Kolkata');

  it('a booking holds its table from 30 minutes before (RESERVED); later ones only show on the tile', () => {
    const id = book();
    book({ guestName: 'Rao', startsAt: at('20:00'), tableIds: [S.t2] });
    expect(table(S.t1)).toMatchObject({ state: 'RESERVED', booking: { reservationId: id, guestName: 'Sharma', partySize: 4, holding: true } });
    expect(table(S.t2)).toMatchObject({ state: 'FREE', booking: { guestName: 'Rao', holding: false } });
    expect(day().reservations.map((r) => [r.guestName, r.status, r.tables.map((t) => t.label)])).toEqual([
      ['Sharma', 'booked', ['T1']],
      ['Rao', 'booked', ['T2']],
    ]);
    expect(h.count('audit_event', "action = 'reservation.create'")).toBe(2);
    expect(h.count('event_log', "event = 'reservations.changed' AND topic = 'reservations'")).toBe(2);
  });

  it('a walk-in on a held table is refused with whose booking it is; "Seat anyway" seats them and records whose it was', () => {
    const id = book();
    expect(h.fail('OpenTable', { tableId: S.t1, covers: 2 }, 'INVALID_STATE').message).toBe('Table T1 is held for Sharma (4) at 14:00.');
    const res = h.run('OpenTable', { tableId: S.t1, covers: 2, ignoreReservation: true });
    const audit = JSON.parse(h.db.prepare("SELECT after_json FROM audit_event WHERE action = 'order.open'").pluck().get() as string) as Record<string, unknown>;
    expect(audit).toMatchObject({ overBookingId: id, overBookingGuest: 'Sharma' });
    expect(res.order).toBeDefined();
  });

  it('two bookings never share a table at overlapping times', () => {
    book(); // 14:00–15:30 on T1
    expect(h.fail('CreateReservation', { guestName: 'Rao', partySize: 2, startsAt: at('15:00'), tableIds: [S.t1] }, 'INVALID_STATE').message).toBe(
      'Table T1 is already booked for Sharma 14:00–15:30.',
    );
    const later = book({ guestName: 'Rao', startsAt: at('15:30') });
    h.fail('UpdateReservation', { reservationId: later, startsAt: at('14:30') }, 'INVALID_STATE');
    h.run('UpdateReservation', { reservationId: later, startsAt: at('14:30'), tableIds: [S.t2], partySize: 3 });
    expect(day().reservations.find((r) => r.id === later)).toMatchObject({ partySize: 3, tables: [{ label: 'T2' }] });
    expect(h.count('audit_event', "action = 'reservation.update'")).toBe(1);
  });

  it('seating the booking opens the order on its table with the party as guests; the hold ends', () => {
    const id = book();
    const res = h.run('SeatReservation', { reservationId: id });
    expect(res.order).toMatchObject({ covers: 4, table: { label: 'T1' } });
    expect(day().reservations[0]).toMatchObject({ status: 'seated', orderId: res.order!.id });
    expect(table(S.t1).state).toBe('SEATED');
    expect(table(S.t1).booking).toBeUndefined();
    h.fail('SeatReservation', { reservationId: id }, 'INVALID_STATE');
  });

  it('seated at another free table when theirs is taken; a table held for someone else is refused', () => {
    const id = book();
    book({ guestName: 'Rao', startsAt: at('14:00'), tableIds: [S.t2] }); // holding T2 from 13:30
    h.run('OpenTable', { tableId: S.t1, covers: 2, ignoreReservation: true }); // their table was given away
    h.fail('SeatReservation', { reservationId: id }, 'INVALID_STATE');
    expect(h.fail('SeatReservation', { reservationId: id, tableId: S.t2 }, 'INVALID_STATE').message).toMatch(/held for Rao/);
    expect(h.run('SeatReservation', { reservationId: id, tableId: T3, covers: 5 }).order).toMatchObject({ covers: 5, table: { label: 'T3' } });
  });

  it('cancelled or no-show: kept, no longer holds the table; late bookings are flagged after the grace time', () => {
    const id = book();
    expect(day(new Date(TEST_NOW().getTime() + 46 * 60_000)).reservations[0]!.late).toBe(true); // 14:16 > 14:00 + 15
    expect(day().reservations[0]!.late).toBe(false);
    h.run('CloseReservation', { reservationId: id, outcome: 'no_show' });
    expect(table(S.t1).state).toBe('FREE');
    expect(day().reservations[0]!.status).toBe('no_show');
    h.fail('CloseReservation', { reservationId: id, outcome: 'cancelled' }, 'INVALID_STATE');
    expect(h.count('audit_event', "action = 'reservation.no_show'")).toBe(1);
  });

  it('VALIDATION for a time gone by; NOT_FOUND for an unknown table or booking; INVALID_STATE for a blocked table', () => {
    h.fail('CreateReservation', { guestName: 'Late', partySize: 2, startsAt: at('13:00'), tableIds: [] }, 'VALIDATION');
    h.fail('CreateReservation', { guestName: 'X', partySize: 2, startsAt: at('19:00'), tableIds: [newId()] }, 'NOT_FOUND');
    h.fail('SeatReservation', { reservationId: newId() }, 'NOT_FOUND');
    h.run('UpsertTable', { id: T3, areaId: S.mainArea, label: 'T3', status: 'blocked' });
    h.fail('CreateReservation', { guestName: 'X', partySize: 2, startsAt: at('19:00'), tableIds: [T3] }, 'INVALID_STATE');
    // Without a table it is fine (assigned later).
    expect(book({ tableIds: [], startsAt: at('13:25') })).toBeTruthy();
  });

  it('FORBIDDEN without reservation.manage; DUPLICATE replay books once', () => {
    expect(h.fail('CreateReservation', { guestName: 'X', partySize: 2, startsAt: at('19:00') }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'reservation.manage' });
    const commandId = newId();
    const payload = { guestName: 'Once', partySize: 2, startsAt: at('19:00'), tableIds: [S.t2] };
    h.run('CreateReservation', payload, { commandId });
    expect(h.run('CreateReservation', payload, { commandId }).duplicate).toBe(true);
    expect(h.count('reservation')).toBe(1);
  });
});

describe('waitlist', () => {
  const h = useHarness();
  beforeEach(() => seedOutlet(h));
  const join = (name = 'Gupta', party = 3) => (h.run('AddToWaitlist', { guestName: name, partySize: party, quotedMin: 20 }).result as { entryId: string }).entryId;

  it('first come first, with the time waited and the wait quoted', () => {
    join('Gupta');
    join('Iyer', 2);
    const later = new Date(TEST_NOW().getTime() + 12 * 60_000);
    expect(getWaitlist(h.db, later, 'Asia/Kolkata').entries.map((e) => [e.guestName, e.partySize, e.quotedMin, e.waitedMin])).toEqual([
      ['Gupta', 3, 20, 12],
      ['Iyer', 2, 20, 12],
    ]);
  });

  it('seating a waiting guest opens the order with their party; off the list; leaving takes them off too', () => {
    const gupta = join('Gupta');
    const iyer = join('Iyer', 2);
    const res = h.run('SeatFromWaitlist', { entryId: gupta, tableId: S.t2 });
    expect(res.order).toMatchObject({ covers: 3, table: { label: 'T2' } });
    h.run('LeaveWaitlist', { entryId: iyer, outcome: 'left' });
    expect(getWaitlist(h.db, TEST_NOW(), 'Asia/Kolkata').entries).toEqual([]);
    h.fail('SeatFromWaitlist', { entryId: iyer, tableId: S.t1 }, 'INVALID_STATE');
    expect(h.count('audit_event', "action IN ('waitlist.add', 'waitlist.seat', 'waitlist.left')")).toBe(4);
  });

  it('a table held for a booking needs "Seat anyway"; an occupied table is refused', () => {
    h.run('CreateReservation', { guestName: 'Sharma', partySize: 4, startsAt: at('14:00'), tableIds: [S.t1] });
    const e = join();
    expect(h.fail('SeatFromWaitlist', { entryId: e, tableId: S.t1 }, 'INVALID_STATE').message).toMatch(/held for Sharma/);
    h.run('SeatFromWaitlist', { entryId: e, tableId: S.t1, ignoreReservation: true });
    h.fail('SeatFromWaitlist', { entryId: join('Iyer'), tableId: S.t1 }, 'INVALID_STATE');
  });

  it('FORBIDDEN without the rights; NOT_FOUND for an unknown entry; DUPLICATE replay adds once', () => {
    expect(h.fail('AddToWaitlist', { guestName: 'X', partySize: 2 }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'reservation.manage' });
    expect(h.fail('SeatFromWaitlist', { entryId: newId(), tableId: S.t1 }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'order.create' });
    h.fail('LeaveWaitlist', { entryId: newId(), outcome: 'left' }, 'NOT_FOUND');
    const commandId = newId();
    h.run('AddToWaitlist', { guestName: 'Once', partySize: 2 }, { commandId });
    expect(h.run('AddToWaitlist', { guestName: 'Once', partySize: 2 }, { commandId }).duplicate).toBe(true);
    expect(h.count('waitlist_entry')).toBe(1);
  });
});

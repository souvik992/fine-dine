import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getFloor } from '../queries/floor.js';
import { seedId } from '../seed/dev-seed.js';
import { denyAll, TEST_NOW, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// P3-04: captains' sections, AssignCaptain and Request bill.
const ravi = seedId('user:captain');
const vikram = seedId('user:manager');
const terrace = seedId('area:terrace');

describe('SetCaptainSection', () => {
  const h = useHarness();
  beforeEach(() => seedOutlet(h));
  const floorTable = (id: string) => getFloor(h.db, TEST_NOW(), 'Asia/Kolkata').tables.find((t) => t.id === id)!;

  it('replaces a captain’s areas and tables, audited before/after; the floor shows who looks after each table', () => {
    h.run('SetCaptainSection', { userId: ravi, areaIds: [S.mainArea], tableIds: [] });
    h.run('SetCaptainSection', { userId: ravi, areaIds: [], tableIds: [S.r1] });
    expect(h.count('captain_section', `user_id = '${ravi}'`)).toBe(1);
    expect(floorTable(S.r1).sectionCaptainIds).toEqual([ravi]);
    expect(floorTable(S.t1).sectionCaptainIds).toBeUndefined();
    const audit = h.db.prepare("SELECT before_json, after_json FROM audit_event WHERE action = 'staff.section' ORDER BY seq DESC LIMIT 1").get() as { before_json: string; after_json: string };
    expect(JSON.parse(audit.before_json)).toEqual({ areaIds: [S.mainArea], tableIds: [] });
    expect(JSON.parse(audit.after_json)).toEqual({ areaIds: [], tableIds: [S.r1] });
    expect(h.count('event_log', "event = 'floor.changed'")).toBeGreaterThan(0);
  });

  it('an area section covers every table in it; two captains on one area both show', () => {
    h.run('SetCaptainSection', { userId: ravi, areaIds: [terrace] });
    h.run('SetCaptainSection', { userId: vikram, areaIds: [terrace] });
    expect(floorTable(S.r1).sectionCaptainIds).toEqual([ravi, vikram].sort());
  });

  it('NOT_FOUND for an unknown person, area or table; VALIDATION for a repeat', () => {
    h.fail('SetCaptainSection', { userId: newId() }, 'NOT_FOUND');
    h.fail('SetCaptainSection', { userId: ravi, areaIds: [newId()] }, 'NOT_FOUND');
    h.fail('SetCaptainSection', { userId: ravi, tableIds: [newId()] }, 'NOT_FOUND');
    h.fail('SetCaptainSection', { userId: ravi, tableIds: [S.t1, S.t1] }, 'VALIDATION');
    expect(h.count('captain_section')).toBe(0);
  });

  it('FORBIDDEN without staff.sections; DUPLICATE replay writes nothing more', () => {
    expect(h.fail('SetCaptainSection', { userId: ravi, areaIds: [S.mainArea] }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'staff.sections' });
    const commandId = newId();
    h.run('SetCaptainSection', { userId: ravi, areaIds: [S.mainArea] }, { commandId });
    expect(h.run('SetCaptainSection', { userId: ravi, areaIds: [S.mainArea] }, { commandId }).duplicate).toBe(true);
    expect(h.count('audit_event', "action = 'staff.section'")).toBe(1);
  });
});

describe('captain on new orders and AssignCaptain', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  beforeEach(() => seedOutlet(h));
  const captainOf = (orderId: string) => h.db.prepare('SELECT captain_id FROM "order" WHERE id = ?').pluck().get(orderId);

  it('a table opened without a captain gets the captain whose section holds it; nobody when two share the area', () => {
    h.run('SetCaptainSection', { userId: ravi, tableIds: [S.t1] });
    h.run('SetCaptainSection', { userId: vikram, areaIds: [S.mainArea] });
    expect(captainOf(o.open(S.t1).order!.id)).toBe(ravi); // listed for the table itself
    expect(captainOf(o.open(S.t2).order!.id)).toBe(vikram); // only Vikram's section holds the area
    h.run('SetCaptainSection', { userId: ravi, areaIds: [terrace] });
    h.run('SetCaptainSection', { userId: vikram, areaIds: [terrace] });
    expect(captainOf(o.open(S.r1).order!.id)).toBeNull();
    const named = h.run('OpenTable', { tableId: seedId('table:main:3'), covers: 2, captainId: vikram });
    expect(captainOf(named.order!.id)).toBe(vikram);
  });

  it('AssignCaptain changes or clears the order’s captain; the floor shows the name; audited', () => {
    const orderId = o.open(S.t1).order!.id;
    o.run('AssignCaptain', orderId, { captainId: ravi });
    const t = getFloor(h.db, TEST_NOW(), 'Asia/Kolkata').tables.find((x) => x.id === S.t1)!;
    expect(t).toMatchObject({ captainId: ravi, captainName: 'Ravi (Captain)' });
    o.run('AssignCaptain', orderId, { captainId: null });
    expect(captainOf(orderId)).toBeNull();
    expect(h.count('audit_event', "action = 'order.captain'")).toBe(2);
  });

  it('AssignCaptain: NOT_FOUND for an unknown person, INVALID_STATE on a settled order, VERSION_CONFLICT, FORBIDDEN, DUPLICATE', () => {
    const orderId = o.open(S.t1).order!.id;
    h.fail('AssignCaptain', { captainId: newId() }, 'NOT_FOUND', { orderId, expectedVersion: 1 });
    h.fail('AssignCaptain', { captainId: ravi }, 'VERSION_CONFLICT', { orderId, expectedVersion: 9 });
    h.fail('AssignCaptain', { captainId: ravi }, 'FORBIDDEN', { orderId, expectedVersion: 1, rights: denyAll });
    const commandId = newId();
    o.run('AssignCaptain', orderId, { captainId: ravi }, { commandId, expectedVersion: 1 });
    expect(o.run('AssignCaptain', orderId, { captainId: ravi }, { commandId, expectedVersion: 1 }).duplicate).toBe(true);
    h.db.prepare(`UPDATE "order" SET state = 'settled' WHERE id = ?`).run(orderId);
    h.fail('AssignCaptain', { captainId: vikram }, 'INVALID_STATE', { orderId, expectedVersion: 2 });
  });
});

describe('RequestBill', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1).order!.id;
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
  });
  const floorT1 = () => getFloor(h.db, TEST_NOW(), 'Asia/Kolkata').tables.find((t) => t.id === S.t1)!;
  const asRavi = { deviceId: null, userId: ravi };

  it('asks the counter: on the floor and the order with who asked, a bill.requested event; printing the bill clears it', () => {
    o.run('FireKOT', orderId, { all: true });
    const res = h.run('RequestBill', {}, { orderId, expectedVersion: 3, actor: asRavi });
    expect(res.order!.billRequest).toEqual({ at: TEST_NOW().toISOString(), byName: 'Ravi (Captain)' });
    expect(floorT1().billRequest).toEqual({ at: TEST_NOW().toISOString(), byName: 'Ravi (Captain)' });
    const ev = JSON.parse(h.db.prepare("SELECT payload_json FROM event_log WHERE event = 'bill.requested'").pluck().get() as string) as Record<string, unknown>;
    expect(ev).toMatchObject({ orderId, tableId: S.t1, tableLabel: 'T1', byName: 'Ravi (Captain)' });
    expect(h.count('audit_event', "action = 'order.bill_request'")).toBe(1);

    o.run('PrintBill', orderId, {});
    expect(floorT1().billRequest).toBeUndefined();
    expect(h.count('bill_request')).toBe(0);
  });

  it('asking again keeps one request (the time moves on)', () => {
    o.run('FireKOT', orderId, { all: true });
    o.run('RequestBill', orderId, {});
    o.run('RequestBill', orderId, {});
    expect(h.count('bill_request')).toBe(1);
    expect(h.count('audit_event', "action = 'order.bill_request'")).toBe(2);
  });

  it('INVALID_STATE before anything is sent, and once the bill is printed', () => {
    expect(h.fail('RequestBill', {}, 'INVALID_STATE', { orderId, expectedVersion: 2 }).message).toMatch(/Nothing has been sent/);
    o.run('FireKOT', orderId, { all: true });
    o.run('PrintBill', orderId, {});
    expect(h.fail('RequestBill', {}, 'INVALID_STATE', { orderId, expectedVersion: 4 }).message).toMatch(/already printed/);
  });

  it('VERSION_CONFLICT, FORBIDDEN and DUPLICATE', () => {
    o.run('FireKOT', orderId, { all: true });
    h.fail('RequestBill', {}, 'VERSION_CONFLICT', { orderId, expectedVersion: 1 });
    expect(h.fail('RequestBill', {}, 'FORBIDDEN', { orderId, expectedVersion: 3, rights: denyAll }).details).toEqual({ right: 'order.edit' });
    const commandId = newId();
    o.run('RequestBill', orderId, {}, { commandId, expectedVersion: 3 });
    expect(o.run('RequestBill', orderId, {}, { commandId, expectedVersion: 3 }).duplicate).toBe(true);
    expect(h.count('audit_event', "action = 'order.bill_request'")).toBe(1);
  });
});

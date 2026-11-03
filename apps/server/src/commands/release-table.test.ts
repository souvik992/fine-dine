import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { runReport } from '../reports/catalog.js';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// Release table: free a table whose order has nothing to bill (opened by mistake, guests left before ordering).
describe('ReleaseTable', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  beforeEach(() => seedOutlet(h));
  const open = () => o.open(S.t1).order!.id;
  const state = (id: string) => h.db.prepare('SELECT state FROM "order" WHERE id = ?').pluck().get(id) as string;

  it('an empty table is free again; the order ends void, out of sales; the audit and the voids report show it', () => {
    const id = open();
    expect(o.tableState(S.t1)).toBe('SEATED');
    const res = o.run('ReleaseTable', id, { reason: 'Guests left' });
    expect(res.result).toEqual({ orderId: id, tableId: S.t1, droppedItems: 0 });
    expect(o.tableState(S.t1)).toBe('FREE');
    expect(state(id)).toBe('void');
    expect(h.count('audit_event', `action = 'order.release' AND entity_id = '${id}' AND reason = 'Guests left'`)).toBe(1);
    expect(o.open(S.t1).order).toBeDefined(); // the table can be opened again
    const report = runReport(h.db, 'voids', '2026-11-02', '2026-11-02', 'Asia/Kolkata');
    expect(report.rows).toEqual([expect.objectContaining({ kind: 'Table released (nothing billed)', reason: 'Guests left', amount: 0 })]);
    expect(report.summary).toContainEqual({ label: 'Tables released', value: 1, type: 'int' });
  });

  it('items not yet sent to the kitchen go with it; the audit keeps what they were', () => {
    const id = open();
    o.run('AddItems', id, { items: [line(S.dalMakhani, { addons: [] }), line(S.virginMojito)] });
    expect(o.run('ReleaseTable', id, {}).result).toMatchObject({ droppedItems: 2 });
    expect(h.count('order_item', `order_id = '${id}'`)).toBe(0);
    const before = JSON.parse(h.db.prepare("SELECT before_json FROM audit_event WHERE action = 'order.release'").pluck().get() as string) as { heldItems: unknown[] };
    expect(before.heldItems).toHaveLength(2);
  });

  it('refused while an item sent to the kitchen is still on it; allowed once it is cancelled', () => {
    const id = open();
    o.run('AddItems', id, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', id, { all: true });
    expect(h.fail('ReleaseTable', {}, 'INVALID_STATE', { orderId: id, expectedVersion: version(id) }).message).toMatch(/1 item was sent to the kitchen/);
    const itemId = h.db.prepare('SELECT id FROM order_item WHERE order_id = ?').pluck().get(id) as string;
    o.run('CancelFiredItem', id, { orderItemId: itemId, reason: 'Guest changed mind', returnToStock: false });
    o.run('ReleaseTable', id, {});
    expect(o.tableState(S.t1)).toBe('FREE');
    expect(h.count('order_item', `order_id = '${id}' AND status = 'cancelled'`)).toBe(1); // the cancelled line stays on record
  });

  it('refused once a bill was printed (void the bill), and for an order that is already closed', () => {
    const id = open();
    o.run('AddItems', id, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', id, { all: true });
    o.run('PrintBill', id, {});
    expect(h.fail('ReleaseTable', {}, 'INVALID_STATE', { orderId: id, expectedVersion: version(id) }).message).toMatch(/Void the bill instead/);
    const other = o.open(S.t2).order!.id;
    o.run('ReleaseTable', other, {});
    expect(h.fail('ReleaseTable', {}, 'INVALID_STATE', { orderId: other, expectedVersion: version(other) }).message).toMatch(/already free/);
  });

  it('refused when a bill number was given and the bill later replaced (so no number goes missing)', () => {
    const id = open();
    o.run('AddItems', id, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', id, { all: true });
    o.run('PrintBill', id, {});
    const itemId = h.db.prepare('SELECT id FROM order_item WHERE order_id = ?').pluck().get(id) as string;
    o.run('CancelFiredItem', id, { orderItemId: itemId, reason: 'Wrong table', returnToStock: false }); // reopens; the bill is superseded
    expect(state(id)).toBe('open');
    expect(h.fail('ReleaseTable', {}, 'INVALID_STATE', { orderId: id, expectedVersion: version(id) }).details).toEqual({ reason: 'has_bill' });
  });

  it('needs the right to open tables; a stale version conflicts; a replay does nothing twice', () => {
    const id = open();
    expect(h.fail('ReleaseTable', {}, 'FORBIDDEN', { orderId: id, expectedVersion: version(id), rights: denyAll }).details).toEqual({ right: 'order.create' });
    h.fail('ReleaseTable', {}, 'VERSION_CONFLICT', { orderId: id, expectedVersion: version(id) + 5 });
    expect(state(id)).toBe('open');
    const commandId = newId();
    const first = o.run('ReleaseTable', id, {}, { commandId, expectedVersion: version(id) });
    expect(o.run('ReleaseTable', id, {}, { commandId, expectedVersion: version(id) - 1 })).toEqual({ ...first, duplicate: true });
    expect(h.count('audit_event', "action = 'order.release'")).toBe(1);
  });

  const version = (id: string) => h.db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(id) as number;
});

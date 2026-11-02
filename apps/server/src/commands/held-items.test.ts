import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// UpdateHeldItem + RemoveHeldItem (they share the "held only" rule).
describe('UpdateHeldItem / RemoveHeldItem', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  let naan: string;
  let dal: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open().order!.id;
    naan = newId();
    dal = newId();
    o.run('AddItems', orderId, { items: [{ id: naan, itemId: S.butterNaan, qty: 2 }, { id: dal, itemId: S.dalMakhani, qty: 1 }] });
  });

  it('UpdateHeldItem changes qty, note, course and addons, audited with before/after', () => {
    const res = o.run('UpdateHeldItem', orderId, { orderItemId: naan, qty: 3, note: 'crispy', course: 2, addons: [{ addonId: S.butter }] });
    const item = o.snapshot(res).items.find((i) => i.id === naan)!;
    expect(item).toMatchObject({ qty: 3, note: 'crispy', course: 2, addons: [{ name: 'Extra butter', pricePaise: 3_000 }] });
    const audit = JSON.parse(h.db.prepare("SELECT before_json FROM audit_event WHERE action = 'order.item.update'").pluck().get() as string) as { qty: number };
    expect(audit.qty).toBe(2);
  });

  it('UpdateHeldItem can clear a note and keeps fields not sent', () => {
    o.run('UpdateHeldItem', orderId, { orderItemId: naan, note: 'x' });
    const res = o.run('UpdateHeldItem', orderId, { orderItemId: naan, note: null });
    expect(o.snapshot(res).items.find((i) => i.id === naan)).toMatchObject({ qty: 2, course: 1 });
    expect(o.snapshot(res).items.find((i) => i.id === naan)?.note).toBeUndefined();
  });

  it('RemoveHeldItem removes the line and its addons; the audit row keeps it', () => {
    o.run('UpdateHeldItem', orderId, { orderItemId: naan, addons: [{ addonId: S.cheese }] });
    const res = o.run('RemoveHeldItem', orderId, { orderItemId: naan });
    expect(o.snapshot(res).items.map((i) => i.id)).toEqual([dal]);
    expect(h.count('order_item_addon')).toBe(0);
    expect(h.db.prepare("SELECT before_json FROM audit_event WHERE action = 'order.item.remove'").pluck().get()).toContain('Butter Naan');
    expect(h.count('audit_event', 'leakage_flag = 1')).toBe(0);
  });

  it('INVALID_STATE once the item was fired', () => {
    o.run('FireKOT', orderId, { itemIds: [naan] });
    h.fail('UpdateHeldItem', { orderItemId: naan, qty: 1 }, 'INVALID_STATE', { orderId, expectedVersion: 3 });
    h.fail('RemoveHeldItem', { orderItemId: naan }, 'INVALID_STATE', { orderId, expectedVersion: 3 });
  });

  it('NOT_FOUND for an item of another order; VALIDATION for an empty update', () => {
    h.fail('RemoveHeldItem', { orderItemId: newId() }, 'NOT_FOUND', { orderId, expectedVersion: 2 });
    h.fail('UpdateHeldItem', { orderItemId: naan }, 'VALIDATION', { orderId, expectedVersion: 2 });
  });

  it('VERSION_CONFLICT, FORBIDDEN and DUPLICATE', () => {
    h.fail('RemoveHeldItem', { orderItemId: naan }, 'VERSION_CONFLICT', { orderId, expectedVersion: 1 });
    h.fail('RemoveHeldItem', { orderItemId: naan }, 'FORBIDDEN', { orderId, expectedVersion: 2, rights: denyAll });
    const commandId = newId();
    o.run('UpdateHeldItem', orderId, { orderItemId: naan, qty: 5 }, { commandId, expectedVersion: 2 });
    expect(o.run('UpdateHeldItem', orderId, { orderItemId: naan, qty: 5 }, { commandId, expectedVersion: 2 }).duplicate).toBe(true);
    expect(h.db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(orderId)).toBe(3);
  });
});

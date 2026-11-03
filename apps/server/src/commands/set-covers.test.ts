import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

describe('SetCovers', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open(S.t1, 2).order!.id;
  });

  it('changes the guests on the order and the floor, audited with before/after', () => {
    const res = o.run('SetCovers', orderId, { covers: 5 });
    expect(o.snapshot(res).covers).toBe(5);
    expect(h.db.prepare('SELECT covers FROM "order" WHERE id = ?').pluck().get(orderId)).toBe(5);
    const row = h.db.prepare("SELECT before_json, after_json FROM audit_event WHERE action = 'order.covers'").get() as { before_json: string; after_json: string };
    expect(JSON.parse(row.before_json)).toEqual({ covers: 2 });
    expect(JSON.parse(row.after_json)).toEqual({ covers: 5 });
  });

  it('INVALID_STATE once the bill is printed; VALIDATION outside 1..99', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    o.run('PrintBill', orderId, {});
    expect(h.fail('SetCovers', { covers: 3 }, 'INVALID_STATE', { orderId, expectedVersion: 4 }).message).toMatch(/bill is already printed/);
    h.fail('SetCovers', { covers: 0 }, 'VALIDATION', { orderId, expectedVersion: 4 });
    h.fail('SetCovers', { covers: 100 }, 'VALIDATION', { orderId, expectedVersion: 4 });
  });

  it('VERSION_CONFLICT, FORBIDDEN and DUPLICATE', () => {
    h.fail('SetCovers', { covers: 3 }, 'VERSION_CONFLICT', { orderId, expectedVersion: 7 });
    h.fail('SetCovers', { covers: 3 }, 'FORBIDDEN', { orderId, expectedVersion: 1, rights: denyAll });
    const commandId = newId();
    o.run('SetCovers', orderId, { covers: 3 }, { commandId, expectedVersion: 1 });
    expect(o.run('SetCovers', orderId, { covers: 3 }, { commandId, expectedVersion: 1 }).duplicate).toBe(true);
    expect(h.count('audit_event', "action = 'order.covers'")).toBe(1);
  });
});

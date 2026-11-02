import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

describe('OpenTable', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  beforeEach(() => seedOutlet(h));

  it('opens a dine-in order at version 1 and seats the table (FREE → SEATED)', () => {
    expect(o.tableState(S.t1)).toBe('FREE');
    const res = o.open(S.t1, 4);
    expect(res.order).toMatchObject({ version: 1, state: 'open', type: 'dine_in', covers: 4, table: { id: S.t1, label: 'T1' }, businessDate: '2026-11-02' });
    expect(h.db.prepare('SELECT open_order_id FROM dining_table WHERE id = ?').pluck().get(S.t1)).toBe(res.order!.id);
    expect(o.tableState(S.t1)).toBe('SEATED');
    expect(h.count('event_log', "event = 'table.state'")).toBe(1);
  });

  it('accepts a client-made order id (offline open, docs/05)', () => {
    const orderId = newId();
    expect(h.run('OpenTable', { tableId: S.t1, covers: 2, orderId }).order?.id).toBe(orderId);
  });

  it('INVALID_STATE on an occupied or blocked table', () => {
    o.open(S.t1);
    h.fail('OpenTable', { tableId: S.t1, covers: 2 }, 'INVALID_STATE');
    h.db.prepare("UPDATE dining_table SET status = 'blocked' WHERE id = ?").run(S.t2);
    h.fail('OpenTable', { tableId: S.t2, covers: 2 }, 'INVALID_STATE');
  });

  it('INVALID_STATE when a client order id is reused', () => {
    const orderId = newId();
    h.run('OpenTable', { tableId: S.t1, covers: 2, orderId });
    h.fail('OpenTable', { tableId: S.t2, covers: 2, orderId }, 'INVALID_STATE');
  });

  it('NOT_FOUND for an unknown table or captain', () => {
    h.fail('OpenTable', { tableId: newId(), covers: 2 }, 'NOT_FOUND');
    h.fail('OpenTable', { tableId: S.t1, covers: 2, captainId: newId() }, 'NOT_FOUND');
  });

  it('FORBIDDEN without order.create', () => {
    expect(h.fail('OpenTable', { tableId: S.t1, covers: 2 }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'order.create' });
  });

  it('DUPLICATE replay returns the same order and does not open a second one', () => {
    const commandId = newId();
    const first = h.run('OpenTable', { tableId: S.t1, covers: 2 }, { commandId });
    const again = h.run('OpenTable', { tableId: S.t1, covers: 2 }, { commandId });
    expect(again.duplicate).toBe(true);
    expect(again.order?.id).toBe(first.order?.id);
    expect(h.count('"order"')).toBe(1);
  });

  it('VALIDATION for zero covers', () => {
    h.fail('OpenTable', { tableId: S.t1, covers: 0 }, 'VALIDATION');
  });
});

import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { adminBasics, useHarness } from '../testing/command-harness.js';

describe('UpsertTable', () => {
  const h = useHarness();
  const areaId = newId();
  const table = { id: newId(), areaId, label: 'T1', seats: 4 };
  const setup = () => h.run('UpsertArea', { id: areaId, name: 'Main' });
  adminBasics(h, 'UpsertTable', 'dining_table', () => ({ ...table }), setup);

  it('NOT_FOUND for an unknown area', () => {
    h.fail('UpsertTable', { ...table, areaId: newId() }, 'NOT_FOUND');
  });

  it('INVALID_STATE for a duplicate label in the same area (case-insensitive)', () => {
    setup();
    h.run('UpsertTable', table);
    h.fail('UpsertTable', { ...table, id: newId(), label: 't1' }, 'INVALID_STATE');
  });

  it('allows the same label in another area', () => {
    setup();
    const other = newId();
    h.run('UpsertArea', { id: other, name: 'Terrace' });
    h.run('UpsertTable', table);
    expect(h.run('UpsertTable', { ...table, id: newId(), areaId: other }).ok).toBe(true);
  });

  it('INVALID_STATE when blocking a table that has an open order', () => {
    setup();
    h.run('UpsertTable', table);
    const orderId = newId();
    h.db.prepare(`INSERT INTO "order" (id, business_date, table_id, type, state, opened_at) VALUES (?, '2026-11-02', ?, 'dine_in', 'open', 'x')`).run(orderId, table.id);
    h.db.prepare('UPDATE dining_table SET open_order_id = ? WHERE id = ?').run(orderId, table.id);
    h.fail('UpsertTable', { ...table, status: 'blocked' }, 'INVALID_STATE');
    // Renaming keeps the open order link.
    h.run('UpsertTable', { ...table, label: 'T1A' });
    expect(h.db.prepare('SELECT open_order_id FROM dining_table WHERE id = ?').pluck().get(table.id)).toBe(orderId);
  });
});

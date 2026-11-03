import type { OutboxEntry } from '@dinepos/client';
import type { FloorSnapshot, FloorTable, OrderItemSnapshot } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { fireItemIds, floorWithPending, freeTables, waitingByTable } from './pending-model.js';

const table = (label: string, extra: Partial<FloorTable> = {}): FloorTable => ({ id: label, label, areaId: 'a', state: 'FREE', ...extra });
const entry = (seq: number, type: OutboxEntry['type'], tableId: string, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  seq,
  commandId: `c${seq}`,
  type,
  orderId: `o-${tableId}`,
  payload: type === 'OpenTable' ? { tableId, covers: 3, orderId: `o-${tableId}` } : {},
  table: { id: tableId, label: tableId, areaId: 'a' },
  label: type,
  by: { userId: 'u', name: 'Ravi', token: 't' },
  queuedAt: 'x',
  offline: true,
  status: 'queued',
  ...extra,
});

describe('waiting changes on the phone', () => {
  const floor = { serverTime: '', areas: [], tables: [table('T1'), table('T2', { state: 'KOT_RUNNING', orderId: 'srv' }), table('T3')] } as FloorSnapshot;

  it('a table seated offline shows as seated with its order; a table the server already has keeps the server view', () => {
    const out = floorWithPending(floor, [entry(1, 'OpenTable', 'T1'), entry(2, 'OpenTable', 'T2')]);
    expect(out.tables.map((t) => [t.label, t.state, t.orderId, t.covers])).toEqual([
      ['T1', 'SEATED', 'o-T1', 3],
      ['T2', 'KOT_RUNNING', 'srv', undefined],
      ['T3', 'FREE', undefined, undefined],
    ]);
    expect(floorWithPending(floor, [])).toBe(floor);
    expect(freeTables(floor, [entry(1, 'OpenTable', 'T1')]).map((t) => t.label)).toEqual(['T3']);
  });

  it('counts waiting changes and problems per table', () => {
    const w = waitingByTable([entry(1, 'OpenTable', 'T1', { status: 'attention' }), entry(2, 'AddItems', 'T1'), entry(3, 'AddItems', 'T3')]);
    expect(Object.fromEntries(w)).toEqual({ T1: { waiting: 2, attention: 1 }, T3: { waiting: 1, attention: 0 } });
  });

  it('Fire names the dishes waiting on screen: all of them, or one course', () => {
    const i = (id: string, course: number, status: OrderItemSnapshot['status'] = 'held') => ({ id, course, status }) as OrderItemSnapshot;
    const view = { items: [i('a', 1), i('b', 2), i('c', 1, 'fired'), i('d', 1)] };
    expect(fireItemIds(view, { all: true })).toEqual(['a', 'b', 'd']);
    expect(fireItemIds(view, { course: 1 })).toEqual(['a', 'd']);
  });
});

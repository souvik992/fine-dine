import type { CommandSuccess, MenuSnapshot, OrderItemSnapshot, OrderSnapshot } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, type CommandOptions } from '../client.js';
import { orderView } from './local-view.js';
import { MemoryOutboxStore, Outbox, rebaseEntry, withoutDependents, type NewEntry, type OutboxEntry } from './outbox.js';

/**
 * A small outlet server: order versions, idempotency by commandId (only accepted commands are remembered), a table
 * that can be taken, held/fired lines. `down` = unreachable; `loseAnswers` = applies the command, answer never arrives.
 */
class FakeServer {
  down = false;
  loseAnswers = 0;
  orders = new Map<string, { version: number; tableId: string; covers: number; items: OrderItemSnapshot[] }>();
  taken = new Set<string>();
  done = new Map<string, CommandSuccess>();
  calls: Array<{ type: string; commandId?: string; expectedVersion?: number; token?: string | null }> = [];
  snap(id: string): OrderSnapshot {
    const o = this.orders.get(id)!;
    return { id, version: o.version, state: 'open', type: 'dine_in', businessDate: 'd', covers: o.covers, openedAt: 'x', items: o.items.map((i) => ({ ...i })), kots: [], bills: [], totals: { subtotalPaise: 0, taxPaise: 0, totalPaise: 0 } };
  }
  /** Another device changes the order. */
  elsewhere(id: string, change: (o: { items: OrderItemSnapshot[] }) => void) {
    change(this.orders.get(id)!);
    this.orders.get(id)!.version++;
  }
  command<R>(type: string, payload: unknown, opts: CommandOptions = {}): Promise<CommandSuccess<R>> {
    this.calls.push({ type, commandId: opts.commandId, expectedVersion: opts.expectedVersion, token: opts.sessionToken });
    if (this.down) return Promise.reject(new ApiError('NETWORK', 'offline'));
    const seen = this.done.get(opts.commandId!);
    if (seen) return Promise.resolve({ ...seen, duplicate: true } as CommandSuccess<R>);
    const p = payload as Record<string, unknown>;
    let orderId = opts.orderId!;
    if (type === 'OpenTable') {
      orderId = p.orderId as string;
      if (this.taken.has(p.tableId as string)) return Promise.reject(new ApiError('INVALID_STATE', 'Table T7 is already occupied.'));
      this.taken.add(p.tableId as string);
      this.orders.set(orderId, { version: 0, tableId: p.tableId as string, covers: p.covers as number, items: [] });
    } else {
      const o = this.orders.get(orderId);
      if (!o) return Promise.reject(new ApiError('NOT_FOUND', 'Order not found.'));
      if (o.version !== opts.expectedVersion) return Promise.reject(new ApiError('VERSION_CONFLICT', 'changed', {}, this.snap(orderId)));
      const line = (id: unknown) => o.items.find((i) => i.id === id);
      if (type === 'AddItems') for (const l of p.items as Array<{ id: string; itemId: string; qty: number }>) o.items.push({ id: l.id, itemId: l.itemId, name: l.itemId, qty: l.qty, unitPricePaise: 100, taxRateBp: 0, addons: [], course: 1, status: 'held' });
      if (type === 'UpdateHeldItem') {
        const l = line(p.orderItemId);
        if (!l || l.status !== 'held') return Promise.reject(new ApiError('INVALID_STATE', 'Already sent to the kitchen.'));
        l.qty = p.qty as number;
      }
      if (type === 'RemoveHeldItem') o.items = o.items.filter((i) => i.id !== p.orderItemId);
      if (type === 'FireKOT') {
        const ids = p.itemIds as string[];
        if (ids.some((id) => line(id)?.status !== 'held')) return Promise.reject(new ApiError('INVALID_STATE', 'That item is not waiting to be sent.'));
        for (const id of ids) line(id)!.status = 'fired';
      }
    }
    this.orders.get(orderId)!.version++;
    const res = { ok: true as const, commandId: opts.commandId!, order: this.snap(orderId), result: null as R };
    this.done.set(opts.commandId!, res);
    if (this.loseAnswers > 0) {
      this.loseAnswers--;
      return Promise.reject(new ApiError('NETWORK', 'answer lost'));
    }
    return Promise.resolve(res);
  }
}

let n = 0;
const id = (p: string) => `${p}${++n}`;
const T5 = { id: 't5', label: 'T5', areaId: 'a' };
const ravi = { userId: 'u1', name: 'Ravi', token: 'tok-ravi' };
const base = (e: Partial<NewEntry> & Pick<NewEntry, 'type' | 'payload'>): NewEntry => ({ commandId: id('c'), orderId: 'o1', table: T5, label: e.type, by: ravi, queuedAt: 'now', ...e });
const add = (lineId: string, expectedVersion: number, orderId = 'o1') => base({ type: 'AddItems', orderId, expectedVersion, payload: { items: [{ id: lineId, itemId: 'DM', qty: 1 }] } });
const open = (orderId: string, tableId = 't5') => base({ type: 'OpenTable', orderId, table: { ...T5, id: tableId }, payload: { tableId, covers: 2, orderId } });

describe('Outbox', () => {
  let server: FakeServer;
  let store: MemoryOutboxStore;
  let box: Outbox;
  const events = { sent: [] as string[], rejected: [] as string[], skipped: [] as string[] };
  beforeEach(async () => {
    server = new FakeServer();
    store = new MemoryOutboxStore();
    events.sent = [];
    events.rejected = [];
    events.skipped = [];
    box = new Outbox(store, server, {
      onSent: (e) => events.sent.push(e.type),
      onRejected: (e, err, dropped) => events.rejected.push(`${e.type}: ${err.message} (+${dropped.length})`),
      onSkipped: (_e, why) => events.skipped.push(why),
    });
    await box.init();
  });

  it('online: each change goes out at once with its commandId, as the captain who made it', async () => {
    await box.enqueue(open('o1'));
    await box.enqueue(add('L1', 1));
    expect(await box.replay()).toBe('done');
    expect(box.list()).toEqual([]);
    expect(server.calls.map((c) => [c.type, c.expectedVersion, c.token])).toEqual([
      ['OpenTable', undefined, 'tok-ravi'],
      ['AddItems', 1, 'tok-ravi'],
    ]);
    expect(events.sent).toEqual(['OpenTable', 'AddItems']);
  });

  it('offline: changes wait in order (and survive a restart), then replay in order when the server is back', async () => {
    server.down = true;
    await box.enqueue(open('o1'));
    await box.enqueue(add('L1', 1));
    await box.enqueue(base({ type: 'FireKOT', expectedVersion: 2, payload: { itemIds: ['L1'] } }));
    expect(await box.replay()).toBe('offline');
    expect(box.list().map((e) => [e.type, e.offline])).toEqual([
      ['OpenTable', true],
      ['AddItems', true],
      ['FireKOT', true],
    ]);

    const again = new Outbox(store, server); // the phone app was closed and opened again
    await again.init();
    server.down = false;
    expect(await again.replay()).toBe('done');
    expect(again.list()).toEqual([]);
    expect(server.orders.get('o1')!.items.map((i) => [i.id, i.status])).toEqual([['L1', 'fired']]);
  });

  it('an answer lost on the way back is replayed with the same commandId: DUPLICATE, applied once', async () => {
    await box.enqueue(open('o1'));
    await box.replay();
    server.loseAnswers = 1;
    await box.enqueue(add('L1', 1));
    expect(await box.replay()).toBe('offline');
    expect(box.list()).toHaveLength(1);
    expect(await box.replay()).toBe('done');
    expect(server.orders.get('o1')!.items).toHaveLength(1);
    const adds = server.calls.filter((c) => c.type === 'AddItems');
    expect(new Set(adds.map((c) => c.commandId)).size).toBe(1);
  });

  it('another device changed the order meanwhile: rebased silently; a quantity change keeps its difference', async () => {
    await box.enqueue(open('o1'));
    await box.enqueue(add('L1', 1));
    await box.replay();
    server.down = true;
    await box.enqueue(base({ type: 'UpdateHeldItem', expectedVersion: 2, qtyFrom: 1, payload: { orderItemId: 'L1', qty: 3 } })); // +2 on the phone
    server.down = false;
    server.elsewhere('o1', (o) => (o.items[0]!.qty = 4)); // the terminal made it 4
    await box.replay();
    expect(server.orders.get('o1')!.items[0]!.qty).toBe(6);
  });

  it('a fire rebased after another device sent some of its dishes sends only the rest; nothing left = skipped', async () => {
    await box.enqueue(open('o1'));
    await box.enqueue(base({ type: 'AddItems', expectedVersion: 1, payload: { items: [{ id: 'A', itemId: 'X', qty: 1 }, { id: 'B', itemId: 'Y', qty: 1 }] } }));
    await box.replay();
    server.elsewhere('o1', (o) => (o.items[0]!.status = 'fired'));
    await box.enqueue(base({ type: 'FireKOT', expectedVersion: 2, payload: { itemIds: ['A', 'B'] } }));
    await box.replay();
    expect(server.orders.get('o1')!.items.map((i) => i.status)).toEqual(['fired', 'fired']);
    server.elsewhere('o1', (o) => o.items.push({ ...o.items[0]!, id: 'C', status: 'held' }));
    server.elsewhere('o1', (o) => (o.items[2]!.status = 'fired'));
    await box.enqueue(base({ type: 'FireKOT', expectedVersion: 3, payload: { itemIds: ['C'] } }));
    await box.replay();
    expect(events.skipped).toEqual(['Already sent to the kitchen from another device.']);
    expect(box.list()).toEqual([]);
  });

  it('refused after waiting offline: Needs attention; later changes to that table wait, other tables go on', async () => {
    server.taken.add('t7');
    server.down = true;
    await box.enqueue(open('o7', 't7'));
    await box.enqueue(add('L7', 1, 'o7'));
    await box.enqueue(open('o6', 't6'));
    await box.replay();
    server.down = false;
    await box.replay();
    expect(box.list().map((e) => [e.type, e.orderId, e.status, e.problem?.message])).toEqual([
      ['OpenTable', 'o7', 'attention', 'Table T7 is already occupied.'],
      ['AddItems', 'o7', 'queued', undefined],
    ]);
    expect(server.orders.has('o6')).toBe(true);

    // The captain seats them at T8 instead: same order id, so the dish follows.
    await box.reseat(box.list()[0]!.seq, { id: 't8', label: 'T8', areaId: 'a' });
    expect(box.list()[0]!.label).toBe('Seat T8 (2 guests)');
    await box.replay();
    expect(box.list()).toEqual([]);
    expect(server.orders.get('o7')).toMatchObject({ tableId: 't8', items: [{ id: 'L7' }] });
  });

  it('discarding a refused OpenTable discards what was ordered for it; retry can send as the captain signed in now', async () => {
    server.taken.add('t7');
    server.down = true;
    await box.enqueue(open('o7', 't7'));
    await box.enqueue(add('L7', 1, 'o7'));
    await box.replay(); // still offline
    server.down = false;
    await box.replay();
    await box.retry(box.list()[0]!.seq, { userId: 'u2', name: 'Meena', token: 'tok-meena' });
    await box.replay();
    expect(server.calls.at(-1)).toMatchObject({ type: 'OpenTable', token: 'tok-meena' });
    expect(box.list()[0]!.status).toBe('attention');
    const dropped = await box.discard(box.list()[0]!.seq);
    expect(dropped.map((e) => e.type)).toEqual(['OpenTable', 'AddItems']);
    expect(box.list()).toEqual([]);
  });

  it('refused while online: told at once (toast), dropped with the changes that needed it', async () => {
    await box.enqueue(open('o1'));
    await box.replay();
    server.taken.add('t9');
    await box.enqueue(open('o9', 't9'));
    await box.enqueue(add('L9', 1, 'o9'));
    await box.replay();
    expect(events.rejected).toEqual(['OpenTable: Table T7 is already occupied. (+1)']);
    expect(box.list()).toEqual([]);
  });

  it('one replay at a time; a change queued during a replay goes out before it finishes', async () => {
    await box.enqueue(open('o1'));
    const first = box.replay();
    await box.enqueue(add('L1', 1));
    const second = box.replay();
    await Promise.all([first, second]);
    expect(box.list()).toEqual([]);
    expect(server.calls.map((c) => c.type)).toEqual(['OpenTable', 'AddItems']);
  });
});

describe('dependents and rebase (pure)', () => {
  const e = (seq: number, type: OutboxEntry['type'], payload: Record<string, unknown>, orderId = 'o1'): OutboxEntry => ({ ...base({ type, payload, orderId }), seq, status: 'queued', offline: true });

  it('dropping an add drops the changes to its lines and takes them out of a fire', () => {
    const list = [
      e(1, 'AddItems', { items: [{ id: 'A' }] }),
      e(2, 'AddItems', { items: [{ id: 'B' }] }),
      e(3, 'UpdateHeldItem', { orderItemId: 'A', qty: 2 }),
      e(4, 'FireKOT', { itemIds: ['A', 'B'] }),
      e(5, 'RemoveHeldItem', { orderItemId: 'A' }, 'o2'),
    ];
    const r = withoutDependents(list, list[0]!);
    expect(r.dropped.map((x) => x.seq)).toEqual([1, 3]);
    expect(r.keep.map((x) => [x.seq, x.payload])).toEqual([
      [2, { items: [{ id: 'B' }] }],
      [4, { itemIds: ['B'] }],
      [5, { orderItemId: 'A' }],
    ]);
  });

  it('a quantity change that would go below one becomes a removal; a missing line is skipped', () => {
    const snap = { version: 9, items: [{ id: 'A', qty: 1, status: 'held' }] } as OrderSnapshot;
    const down = { ...e(1, 'UpdateHeldItem', { orderItemId: 'A', qty: 1 }), qtyFrom: 3 }; // −2 on the phone
    expect(rebaseEntry(down, snap)).toMatchObject({ entry: { type: 'RemoveHeldItem', expectedVersion: 9, payload: { orderItemId: 'A' } } });
    expect(rebaseEntry(e(2, 'UpdateHeldItem', { orderItemId: 'Z', qty: 2 }), snap)).toEqual({ drop: 'That dish was removed on another device.' });
    expect(rebaseEntry(e(3, 'RemoveHeldItem', { orderItemId: 'Z' }), snap)).toEqual({ drop: 'That dish was already removed on another device.' });
  });
});

describe('orderView', () => {
  const menu = {
    menuVersion: 1,
    pricingMode: 'exclusive',
    stations: [],
    categories: [],
    addonGroups: [{ id: 'g', name: 'Extras', minSelect: 0, maxSelect: 2, addons: [{ id: 'butter', name: 'Extra butter', pricePaise: 3_000 }] }],
    items: [
      { id: 'DM', categoryId: 'c', name: 'Dal Makhani', veg: true, pricePaise: 28_000, taxRateBp: 500, available: true, sort: 0, variants: [], addonGroupIds: ['g'] },
      { id: 'BC', categoryId: 'c', name: 'Butter Chicken', veg: false, pricePaise: 30_000, taxRateBp: 500, available: true, sort: 1, variants: [{ id: 'full', name: 'Full', pricePaise: 52_000, sort: 0 }], addonGroupIds: [] },
    ],
  } as unknown as MenuSnapshot;
  const q = (seq: number, type: OutboxEntry['type'], payload: Record<string, unknown>, status: OutboxEntry['status'] = 'queued'): OutboxEntry => ({ ...base({ type, payload, orderId: 'o1' }), seq, status, offline: true });

  it('a table seated offline: the waiting dishes with menu names and prices, totals like the server, next version', () => {
    const v = orderView(
      'o1',
      undefined,
      [
        q(1, 'OpenTable', { tableId: 't5', covers: 3, orderId: 'o1' }),
        q(2, 'AddItems', { items: [{ id: 'A', itemId: 'DM', qty: 2, addons: [{ addonId: 'butter', qty: 1 }] }, { id: 'B', itemId: 'BC', variantId: 'full', qty: 1 }] }),
        q(3, 'FireKOT', { itemIds: ['B'] }),
      ],
      menu,
    )!;
    expect(v.table?.label).toBe('T5');
    expect(v.covers).toBe(3);
    expect(v.version).toBe(3);
    expect(v.items.map((i) => [i.name, i.qty, i.unitPricePaise, i.addons.map((a) => a.name), i.status, i.waiting, i.queuedFire])).toEqual([
      ['Dal Makhani', 2, 28_000, ['Extra butter'], 'held', true, undefined],
      ['Butter Chicken (Full)', 1, 52_000, [], 'fired', true, true],
    ]);
    // 2 × 280 + 30 + 520 = 1,110.00; 5% GST = 55.50
    expect(v.totals).toEqual({ subtotalPaise: 111_000, taxPaise: 5_550, totalPaise: 116_550 });
    expect(v.waiting).toBe(3);
  });

  it('server snapshot plus waiting changes; attention counted; no outbox = the snapshot as is', () => {
    const snap: OrderSnapshot = { id: 'o1', version: 4, state: 'open', type: 'dine_in', businessDate: 'd', covers: 2, openedAt: 'x', items: [{ id: 'A', itemId: 'DM', name: 'Dal Makhani', qty: 1, unitPricePaise: 28_000, taxRateBp: 500, addons: [], course: 1, status: 'held' }], kots: [], bills: [], totals: { subtotalPaise: 28_000, taxPaise: 1_400, totalPaise: 29_400 } };
    expect(orderView('o1', snap, [], menu)).toMatchObject({ version: 4, totals: snap.totals, waiting: 0 });
    const v = orderView('o1', snap, [q(1, 'UpdateHeldItem', { orderItemId: 'A', qty: 3 }), q(2, 'SetCovers', { covers: 5 }, 'attention'), q(3, 'RequestBill', {})], menu)!;
    expect(v).toMatchObject({ version: 7, covers: 5, waiting: 3, attention: 1, items: [{ qty: 3, waiting: true }], billRequest: { at: 'now', byName: 'Ravi' } });
    expect(orderView('nope', undefined, [], menu)).toBeNull();
  });
});

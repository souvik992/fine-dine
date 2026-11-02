import type { CommandSuccess, OrderItemSnapshot, OrderSnapshot } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, type CommandOptions } from '../api/client.js';
import { addOrMerge, changeBy, type LineCommand, type NewLine } from './order-lines.js';
import { OrderSession } from './order-session.js';

const held = (over: Partial<OrderItemSnapshot> = {}): OrderItemSnapshot => ({
  id: 'L1',
  itemId: 'PT',
  name: 'Paneer Tikka',
  qty: 1,
  unitPricePaise: 32_000,
  taxRateBp: 500,
  addons: [],
  course: 1,
  status: 'held',
  ...over,
});
const line = (over: Partial<NewLine> = {}): NewLine => ({ id: 'N1', itemId: 'PT', variantId: null, qty: 1, addons: [], note: null, course: 1, ...over });

describe('adding an item that is already in the cart', () => {
  it('raises the held line instead of adding a second one', () => {
    expect(addOrMerge({ items: [held({ qty: 2 })] }, line({ qty: 3 }))).toEqual({ type: 'UpdateHeldItem', payload: { orderItemId: 'L1', qty: 5 } });
  });

  it('matches size, add-ons (in any order), note and course; otherwise adds a new line', () => {
    const addons = [
      { addonId: 'mild', name: 'Mild', qty: 1, pricePaise: 0 },
      { addonId: 'cheese', name: 'Cheese', qty: 1, pricePaise: 4000 },
    ];
    const items = [held({ variantId: 'half', addons, note: 'less oil', course: 2 })];
    const same = line({ variantId: 'half', addons: [{ addonId: 'cheese', qty: 1 }, { addonId: 'mild', qty: 1 }], note: 'less oil', course: 2 });
    expect(addOrMerge({ items }, same).type).toBe('UpdateHeldItem');
    for (const differs of [{ variantId: 'full' }, { addons: [{ addonId: 'mild', qty: 1 }] }, { note: null }, { course: 1 }, { itemId: 'DM' }]) {
      expect(addOrMerge({ items }, { ...same, ...differs }).type, JSON.stringify(differs)).toBe('AddItems');
    }
  });

  it('never adds to a line already sent to the kitchen, or past 999', () => {
    expect(addOrMerge({ items: [held({ status: 'fired' })] }, line()).type).toBe('AddItems');
    expect(addOrMerge({ items: [held({ qty: 999 })] }, line()).type).toBe('AddItems');
  });

  it('an empty note on either side counts as no note', () => {
    expect(addOrMerge({ items: [held()] }, line({ note: '' })).type).toBe('UpdateHeldItem');
  });

  it('+ / − change the latest quantity; nothing below 1 or on a fired line', () => {
    expect(changeBy({ items: [held({ qty: 4 })] }, 'L1', 1)).toEqual({ type: 'UpdateHeldItem', payload: { orderItemId: 'L1', qty: 5 } });
    expect(changeBy({ items: [held({ qty: 1 })] }, 'L1', -1)).toBeNull();
    expect(changeBy({ items: [held({ status: 'fired' })] }, 'L1', 1)).toBeNull();
    expect(changeBy({ items: [] }, 'L1', 1)).toBeNull();
  });
});

/** A fake server that applies cart commands, to check what quick repeated taps end up as. */
class CartServer {
  version = 1;
  items: OrderItemSnapshot[] = [];
  snap = (): OrderSnapshot => ({
    id: 'o1',
    version: this.version,
    state: 'open',
    type: 'dine_in',
    businessDate: '2026-11-02',
    covers: 2,
    openedAt: 'x',
    items: this.items.map((i) => ({ ...i })),
    kots: [],
    bills: [],
    totals: { subtotalPaise: 0, taxPaise: 0, totalPaise: 0 },
  });
  get<T>(): Promise<T> {
    return Promise.resolve(this.snap() as T);
  }
  async command<R>(type: string, payload: unknown, opts: CommandOptions = {}): Promise<CommandSuccess<R>> {
    await new Promise((r) => setTimeout(r, 1));
    if (opts.expectedVersion !== this.version) throw new ApiError('VERSION_CONFLICT', 'changed', {}, this.snap());
    const cmd = { type, payload } as LineCommand;
    if (cmd.type === 'AddItems') for (const l of cmd.payload.items) this.items.push(held({ id: l.id, itemId: l.itemId, qty: l.qty }));
    else this.items.find((i) => i.id === cmd.payload.orderItemId)!.qty = cmd.payload.qty;
    this.version++;
    return { ok: true, commandId: opts.commandId!, order: this.snap(), version: this.version, result: null as R };
  }
}

describe('quick repeated taps (decided on the latest order)', () => {
  it('tapping the same item 4 times fast gives one line of 4', async () => {
    const server = new CartServer();
    const s = new OrderSession(server, 'o1');
    await Promise.all([1, 2, 3, 4].map((n) => s.runLatest((o) => addOrMerge(o, line({ id: `N${n}` })))));
    expect(server.items.map((i) => [i.itemId, i.qty])).toEqual([['PT', 4]]);
  });

  it('three fast + presses add three', async () => {
    const server = new CartServer();
    server.items = [held({ qty: 2 })];
    const s = new OrderSession(server, 'o1');
    await Promise.all([1, 2, 3].map(() => s.runLatest((o) => changeBy(o, 'L1', 1))));
    expect(server.items[0]!.qty).toBe(5);
  });

  it('after another terminal changed the order, the tap is decided again on the newer order', async () => {
    const server = new CartServer();
    const s = new OrderSession(server, 'o1');
    await s.refresh();
    server.items = [held({ id: 'X', qty: 2 })]; // added elsewhere
    server.version = 7;
    await s.runLatest((o) => addOrMerge(o, line()));
    expect(server.items.map((i) => [i.id, i.qty])).toEqual([['X', 3]]);
  });
});

import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

describe('AddItems', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let orderId: string;
  beforeEach(() => {
    seedOutlet(h);
    orderId = o.open().order!.id;
  });

  it('adds held items with name, price and tax snapshots, and bumps the version', () => {
    const res = o.run('AddItems', orderId, {
      items: [line(S.tandooriChicken, { variantId: S.tcHalf, qty: 2 }), line(S.butterNaan, { addons: [{ addonId: S.cheese }], note: 'well done' })],
    });
    const snap = o.snapshot(res);
    expect(snap.version).toBe(2);
    expect(snap.items.map((i) => [i.name, i.qty, i.unitPricePaise, i.taxRateBp, i.status])).toEqual([
      ['Tandoori Chicken (Half)', 2, 32_000, 500, 'held'],
      ['Butter Naan', 1, 6_000, 500, 'held'],
    ]);
    expect(snap.items[1]!.addons).toEqual([{ addonId: S.cheese, name: 'Extra cheese', qty: 1, pricePaise: 4_000 }]);
    // 64000 + 6000 + 4000 = 74000; 5% = 3700
    expect(snap.totals).toEqual({ subtotalPaise: 74_000, taxPaise: 3_700, totalPaise: 77_700 });
  });

  it('snapshots survive a later menu price change', () => {
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    h.run('UpsertMenuItem', { id: S.dalMakhani, categoryId: h.db.prepare('SELECT category_id FROM menu_item WHERE id = ?').pluck().get(S.dalMakhani), name: 'Dal Makhani', veg: true, basePricePaise: 99_900, taxRateBp: 1800 });
    expect(h.db.prepare('SELECT unit_price_paise, tax_rate_bp, name_snapshot FROM order_item').get()).toEqual({ unit_price_paise: 28_000, tax_rate_bp: 500, name_snapshot: 'Dal Makhani' });
  });

  it("uses the table area's price list", () => {
    const pl = newId();
    h.db.prepare("INSERT INTO price_list (id, name) VALUES (?, 'Main hall')").run(pl);
    h.db.prepare('INSERT INTO price_list_entry (price_list_id, item_id, variant_id, price_paise) VALUES (?, ?, NULL, 30000)').run(pl, S.dalMakhani);
    h.db.prepare('UPDATE area SET price_list_id = ? WHERE id = ?').run(pl, S.mainArea);
    o.run('AddItems', orderId, { items: [line(S.dalMakhani)] });
    expect(h.db.prepare('SELECT unit_price_paise FROM order_item').pluck().get()).toBe(30_000);
  });

  it('VALIDATION when a required addon group is missing, over max, or an addon is not offered', () => {
    const err = h.fail('AddItems', { items: [line(S.paneerTikka)] }, 'VALIDATION', { orderId, expectedVersion: 1 });
    expect(err.message).toBe('Spice level: choose 1.');
    h.fail('AddItems', { items: [line(S.paneerTikka, { addons: [{ addonId: S.mild }, { addonId: S.hot }] })] }, 'VALIDATION', { orderId, expectedVersion: 1 });
    h.fail('AddItems', { items: [line(S.dalMakhani, { addons: [{ addonId: S.mild }] })] }, 'VALIDATION', { orderId, expectedVersion: 1 });
  });

  it('VALIDATION when an item with options has none chosen; NOT_FOUND for a wrong variant', () => {
    h.fail('AddItems', { items: [line(S.tandooriChicken)] }, 'VALIDATION', { orderId, expectedVersion: 1 });
    h.fail('AddItems', { items: [line(S.dalMakhani, { variantId: S.tcHalf })] }, 'NOT_FOUND', { orderId, expectedVersion: 1 });
  });

  it('INVALID_STATE for an unavailable item and for a settled order', () => {
    h.db.prepare('UPDATE menu_item SET available = 0 WHERE id = ?').run(S.dalMakhani);
    h.fail('AddItems', { items: [line(S.dalMakhani)] }, 'INVALID_STATE', { orderId, expectedVersion: 1 });
    h.db.prepare(`UPDATE "order" SET state = 'settled' WHERE id = ?`).run(orderId);
    h.fail('AddItems', { items: [line(S.butterNaan)] }, 'INVALID_STATE', { orderId, expectedVersion: 1 });
  });

  it('adding after the bill was printed reopens the order and supersedes the bill', () => {
    h.db.prepare(`UPDATE "order" SET state = 'billed' WHERE id = ?`).run(orderId);
    h.db.prepare(`INSERT INTO bill (id, order_id, fy, bill_no, subtotal_paise, total_paise, state) VALUES ('B1', ?, '26-27', 1, 0, 0, 'printed')`).run(orderId);
    expect(o.run('AddItems', orderId, { items: [line(S.butterNaan)] }).order?.state).toBe('open');
    expect(h.db.prepare("SELECT state FROM bill WHERE id = 'B1'").pluck().get()).toBe('superseded');
  });

  it('VERSION_CONFLICT on a stale version, with nothing added', () => {
    o.run('AddItems', orderId, { items: [line(S.butterNaan)] });
    h.fail('AddItems', { items: [line(S.dalMakhani)] }, 'VERSION_CONFLICT', { orderId, expectedVersion: 1 });
    expect(h.count('order_item')).toBe(1);
  });

  it('FORBIDDEN without order.edit', () => {
    h.fail('AddItems', { items: [line(S.butterNaan)] }, 'FORBIDDEN', { orderId, expectedVersion: 1, rights: denyAll });
  });

  it('DUPLICATE replay does not add the items twice', () => {
    const commandId = newId();
    const payload = { items: [line(S.butterNaan)] };
    o.run('AddItems', orderId, payload, { commandId, expectedVersion: 1 });
    expect(o.run('AddItems', orderId, payload, { commandId, expectedVersion: 1 }).duplicate).toBe(true);
    expect(h.count('order_item')).toBe(1);
  });

  it('VALIDATION for a reused line id, fractional qty or duplicate ids in one call', () => {
    const l = line(S.butterNaan);
    o.run('AddItems', orderId, { items: [l] });
    h.fail('AddItems', { items: [l] }, 'VALIDATION', { orderId, expectedVersion: 2 });
    h.fail('AddItems', { items: [line(S.butterNaan, { qty: 1.5 })] }, 'VALIDATION', { orderId, expectedVersion: 2 });
    h.fail('AddItems', { items: [l, l] }, 'VALIDATION', { orderId, expectedVersion: 2 });
  });
});

import { newId } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TEST_NOW, useHarness } from '../testing/command-harness.js';
import { getFloor } from './floor.js';
import { getMenu } from './menu.js';

describe('floor + menu queries', () => {
  const h = useHarness();
  const areaId = newId();
  const tableId = newId();
  const catId = newId();
  const itemId = newId();
  const variantId = newId();

  const setup = () => {
    h.run('UpsertArea', { id: areaId, name: 'Main' });
    h.run('UpsertTable', { id: tableId, areaId, label: 'T7' });
    h.run('UpsertCategory', { id: catId, name: 'Mains' });
    h.run('UpsertMenuItem', {
      id: itemId,
      categoryId: catId,
      name: 'Dal',
      veg: true,
      basePricePaise: 20_000,
      taxRateBp: 500,
      variants: [{ id: variantId, name: 'Large', pricePaise: 30_000 }],
    });
  };

  function seatOrder(opts: { kot?: boolean; billPrintedAt?: string; lastKotAt?: string } = {}): string {
    const orderId = newId();
    h.db
      .prepare(
        `INSERT INTO "order" (id, business_date, table_id, type, covers, state, opened_at, last_kot_at, bill_printed_at)
         VALUES (?, '2026-11-02', ?, 'dine_in', 2, 'open', '2026-11-02T07:15:00.000Z', ?, ?)`,
      )
      .run(orderId, tableId, opts.lastKotAt ?? null, opts.billPrintedAt ?? null);
    h.db.prepare('UPDATE dining_table SET open_order_id = ? WHERE id = ?').run(orderId, tableId);
    h.db
      .prepare(
        `INSERT INTO order_item (id, order_id, item_id, name_snapshot, qty, unit_price_paise, tax_rate_bp, status, added_at)
         VALUES (?, ?, ?, 'Dal', 2, 20000, 500, 'held', 'x')`,
      )
      .run(newId(), orderId, itemId);
    if (opts.kot) {
      h.run('UpsertStation', { id: 'S'.padEnd(26, '0'), name: 'K' });
      h.db
        .prepare(`INSERT INTO kot (id, order_id, station_id, business_date, kot_no, kind, fired_at) VALUES (?, ?, ?, '2026-11-02', 1, 'new', 'x')`)
        .run(newId(), orderId, 'S'.padEnd(26, '0'));
    }
    return orderId;
  }

  const t7 = () => getFloor(h.db, TEST_NOW(), 'Asia/Kolkata').tables[0]!;

  it('a seated table shows SEATED with covers, elapsed minutes and running amount', () => {
    setup();
    const orderId = seatOrder();
    expect(t7()).toMatchObject({ state: 'SEATED', orderId, covers: 2, elapsedMin: 45, amountPaise: 42_000 });
  });

  it('derives KOT_RUNNING and BILL_PRINTED', () => {
    setup();
    seatOrder({ kot: true, lastKotAt: '2026-11-02T07:30:00Z' });
    expect(t7().state).toBe('KOT_RUNNING');
    h.db.prepare(`UPDATE "order" SET bill_printed_at = '2026-11-02T07:50:00Z'`).run();
    expect(t7().state).toBe('BILL_PRINTED');
  });

  it('a blocked table shows BLOCKED', () => {
    setup();
    h.run('UpsertTable', { id: tableId, areaId, label: 'T7', status: 'blocked' });
    expect(t7().state).toBe('BLOCKED');
  });

  it('menu: since=current answers unchanged; inactive items are hidden', () => {
    setup();
    const full = getMenu(h.db);
    expect('unchanged' in full).toBe(false);
    expect(getMenu(h.db, { since: full.menuVersion })).toEqual({ menuVersion: full.menuVersion, unchanged: true });
    h.run('UpsertMenuItem', { id: itemId, categoryId: catId, name: 'Dal', veg: true, basePricePaise: 20_000, taxRateBp: 500, active: false });
    const after = getMenu(h.db, { since: full.menuVersion });
    expect('items' in after && after.items).toEqual([]);
  });

  it("menu applies the area's price list to base and variant prices", () => {
    setup();
    const pl = newId();
    h.db.prepare("INSERT INTO price_list (id, name) VALUES (?, 'Terrace')").run(pl);
    h.db.prepare('INSERT INTO price_list_entry (price_list_id, item_id, variant_id, price_paise) VALUES (?, ?, NULL, 25000), (?, ?, ?, 35000)').run(pl, itemId, pl, itemId, variantId);
    h.run('UpsertArea', { id: areaId, name: 'Main', priceListId: pl });
    const menu = getMenu(h.db, { areaId });
    if (!('items' in menu)) throw new Error('expected items');
    expect(menu.items[0]).toMatchObject({ pricePaise: 25_000, variants: [{ pricePaise: 35_000 }] });
    expect(menu.pricingMode).toBe('exclusive'); // the area's tax pricing, for totals on the phone (P3-03)
    expect('pricingMode' in (getMenu(h.db) as object)).toBe(false);
    expect(() => getMenu(h.db, { areaId: newId() })).toThrow(/Area not found/);
  });

  it('GET /v1/floor and /v1/menu over HTTP', async () => {
    setup();
    const app = buildApp({ db: h.db, timeZone: 'Asia/Kolkata', now: TEST_NOW });
    const floor = await app.inject({ method: 'GET', url: '/v1/floor' });
    expect(floor.statusCode).toBe(200);
    expect(floor.json()).toMatchObject({ areas: [{ id: areaId }], tables: [{ id: tableId, state: 'FREE' }] });
    const menu = await app.inject({ method: 'GET', url: `/v1/menu?areaId=${areaId}` });
    expect(menu.json()).toMatchObject({ areaId, items: [{ id: itemId }] });
    expect((await app.inject({ method: 'GET', url: '/v1/menu?since=abc' })).json()).toMatchObject({ error: { code: 'VALIDATION' } });

    const orderId = seatOrder();
    const order = await app.inject({ method: 'GET', url: `/v1/orders/${orderId}` });
    expect(order.statusCode).toBe(200);
    expect(order.json()).toMatchObject({ id: orderId, version: 1, items: [{ name: 'Dal', qty: 2 }], totals: { totalPaise: 42_000 } });
    expect((await app.inject({ method: 'GET', url: `/v1/orders/${newId()}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/orders/nope' })).statusCode).toBe(400);
    await app.close();
  });
});

// Helpers shared by the order commands (OpenTable … FireKOT).
import { deriveTableState } from '@dinepos/shared';
import type { OrderRow } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { getOrderSnapshot } from '../queries/order-snapshot.js';
import { getConfig } from '../core/outlet-config.js';

/** States in which items may be added, edited or fired. */
export function requireEditable(order: OrderRow): void {
  if (order.state !== 'open' && order.state !== 'billed') {
    throw new PosError('INVALID_STATE', `This order is ${order.state}; it can no longer be changed.`, { state: order.state });
  }
}

/**
 * Adding or firing after the bill was printed returns the order to `open` and supersedes the unpaid bill
 * (docs/02 state machine). The bill number is reused at the next PrintBill (P1-10).
 */
export function reopenIfBilled(ctx: CommandContext, order: OrderRow): void {
  if (order.state !== 'billed') return;
  ctx.db.prepare(`UPDATE "order" SET state = 'open' WHERE id = ?`).run(order.id);
  const bills = ctx.db.prepare(`SELECT id FROM bill WHERE order_id = ? AND state = 'printed'`).pluck().all(order.id) as string[];
  ctx.db.prepare(`UPDATE bill SET state = 'superseded' WHERE order_id = ? AND state = 'printed'`).run(order.id);
  ctx.audit({ entity: 'order', entityId: order.id, action: 'order.reopen', before: { state: 'billed' }, after: { state: 'open', supersededBills: bills } });
}

export interface ItemContext {
  areaId: string | null;
  priceListId: string | null;
}

export function orderItemContext(db: Db, order: OrderRow): ItemContext {
  if (!order.table_id) return { areaId: null, priceListId: null };
  const row = db
    .prepare('SELECT a.id AS area_id, a.price_list_id FROM dining_table t JOIN area a ON a.id = t.area_id WHERE t.id = ?')
    .get(order.table_id) as { area_id: string; price_list_id: string | null } | undefined;
  return { areaId: row?.area_id ?? null, priceListId: row?.price_list_id ?? null };
}

interface MenuItemRow {
  id: string;
  category_id: string;
  name: string;
  base_price_paise: number;
  tax_rate_bp: number;
  station_id: string | null;
  available: number;
  active: number;
}

export interface PricedItem {
  itemId: string;
  variantId: string | null;
  nameSnapshot: string;
  unitPricePaise: number;
  taxRateBp: number;
}

/** Resolves name, price (area price list first) and tax rate for a line. These are snapshotted on order_item. */
export function priceItem(db: Db, ictx: ItemContext, itemId: string, variantId: string | null): PricedItem {
  const item = db.prepare('SELECT * FROM menu_item WHERE id = ?').get(itemId) as MenuItemRow | undefined;
  if (!item || item.active !== 1) throw new PosError('NOT_FOUND', 'Menu item not found.', { itemId });
  if (item.available !== 1) throw new PosError('INVALID_STATE', `${item.name} is not available right now.`, { itemId });

  const override = (vId: string | null) =>
    ictx.priceListId
      ? (db
          .prepare('SELECT price_paise FROM price_list_entry WHERE price_list_id = ? AND item_id = ? AND variant_id IS ?')
          .pluck()
          .get(ictx.priceListId, itemId, vId) as number | undefined)
      : undefined;

  if (variantId) {
    const v = db.prepare('SELECT name, price_paise FROM variant WHERE id = ? AND item_id = ?').get(variantId, itemId) as
      | { name: string; price_paise: number }
      | undefined;
    if (!v) throw new PosError('NOT_FOUND', `That option does not exist for ${item.name}.`, { itemId, variantId });
    return {
      itemId,
      variantId,
      nameSnapshot: `${item.name} (${v.name})`,
      unitPricePaise: override(variantId) ?? v.price_paise,
      taxRateBp: item.tax_rate_bp,
    };
  }
  const hasVariants = db.prepare('SELECT 1 FROM variant WHERE item_id = ? LIMIT 1').get(itemId);
  if (hasVariants) throw new PosError('VALIDATION', `Choose an option for ${item.name}.`, { itemId, field: 'variantId' });
  return { itemId, variantId: null, nameSnapshot: item.name, unitPricePaise: override(null) ?? item.base_price_paise, taxRateBp: item.tax_rate_bp };
}

export interface PricedAddon {
  addonId: string;
  nameSnapshot: string;
  qty: number;
  pricePaise: number;
}

/** Checks addons belong to the item's groups and every group's min/max selection; returns snapshots. */
export function priceAddons(db: Db, itemId: string, addons: ReadonlyArray<{ addonId: string; qty: number }>): PricedAddon[] {
  const ids = addons.map((a) => a.addonId);
  if (new Set(ids).size !== ids.length) throw new PosError('VALIDATION', 'An addon is listed twice.', { itemId });

  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.min_select, g.max_select FROM item_addon_group l JOIN addon_group g ON g.id = l.group_id
       WHERE l.item_id = ?`,
    )
    .all(itemId) as Array<{ id: string; name: string; min_select: number | null; max_select: number | null }>;
  const byGroup = new Map(groups.map((g) => [g.id, 0]));
  const addonRow = db.prepare('SELECT id, group_id, name, price_paise FROM addon WHERE id = ?');

  const priced = addons.map((a) => {
    const row = addonRow.get(a.addonId) as { id: string; group_id: string; name: string; price_paise: number } | undefined;
    if (!row || !byGroup.has(row.group_id)) {
      throw new PosError('VALIDATION', 'That addon is not offered for this item.', { itemId, addonId: a.addonId });
    }
    byGroup.set(row.group_id, byGroup.get(row.group_id)! + 1);
    return { addonId: row.id, nameSnapshot: row.name, qty: a.qty, pricePaise: row.price_paise };
  });

  for (const g of groups) {
    const n = byGroup.get(g.id) ?? 0;
    const min = g.min_select ?? 0;
    const max = g.max_select ?? 1;
    if (n < min || n > max) {
      throw new PosError('VALIDATION', `${g.name}: choose ${min === max ? min : `${min} to ${max}`}.`, { itemId, groupId: g.id, min, max, chosen: n });
    }
  }
  return priced;
}

export function writeAddons(db: Db, orderItemId: string, addons: PricedAddon[]): void {
  db.prepare('DELETE FROM order_item_addon WHERE order_item_id = ?').run(orderItemId);
  const ins = db.prepare('INSERT INTO order_item_addon (order_item_id, addon_id, name_snapshot, qty, price_paise) VALUES (?, ?, ?, ?, ?)');
  for (const a of addons) ins.run(orderItemId, a.addonId, a.nameSnapshot, a.qty, a.pricePaise);
}

/**
 * Station for a fired item (docs/06 routing): area override for the category → item → category (walking
 * up parents) → outlet default (`config` key `kot.default_station_id`). Null when none is set.
 */
export function resolveStation(db: Db, areaId: string | null, itemId: string): string | null {
  const item = db.prepare('SELECT category_id, station_id FROM menu_item WHERE id = ?').get(itemId) as
    | { category_id: string; station_id: string | null }
    | undefined;
  if (!item) return null;
  const parentOf = db.prepare('SELECT parent_id, station_id FROM category WHERE id = ?');
  const override = db.prepare('SELECT station_id FROM area_station_override WHERE area_id = ? AND category_id = ?').pluck();

  if (areaId) {
    const seen = new Set<string>();
    for (let c: string | null = item.category_id; c && !seen.has(c); ) {
      seen.add(c);
      const s = override.get(areaId, c) as string | undefined;
      if (s) return s;
      c = ((parentOf.get(c) as { parent_id: string | null } | undefined)?.parent_id ?? null);
    }
  }
  if (item.station_id) return item.station_id;
  const seen = new Set<string>();
  for (let c: string | null = item.category_id; c && !seen.has(c); ) {
    seen.add(c);
    const row = parentOf.get(c) as { parent_id: string | null; station_id: string | null } | undefined;
    if (row?.station_id) return row.station_id;
    c = row?.parent_id ?? null;
  }
  return getConfig(db)['kot.default_station_id'];
}

/** Next value of a gap-free counter (inside the command transaction). */
export function nextCounter(db: Db, name: string): number {
  db.prepare('INSERT INTO counter (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1').run(name);
  return db.prepare('SELECT value FROM counter WHERE name = ?').pluck().get(name) as number;
}

/** Announces the derived state of a table (docs/04 `table.state`). */
export function emitTableState(ctx: CommandContext, tableId: string | null): void {
  if (!tableId) return;
  const t = ctx.db.prepare('SELECT status, open_order_id FROM dining_table WHERE id = ?').get(tableId) as
    | { status: 'active' | 'reserved' | 'blocked'; open_order_id: string | null }
    | undefined;
  if (!t) return;
  const order = t.open_order_id ? ctx.db.prepare('SELECT * FROM "order" WHERE id = ?').get(t.open_order_id) as OrderRow | undefined : undefined;
  const hasKot = order ? ctx.db.prepare('SELECT 1 FROM kot WHERE order_id = ? LIMIT 1').get(order.id) !== undefined : false;
  const state = deriveTableState(
    { status: t.status },
    order ? { hasFiredKot: hasKot, lastKotAt: order.last_kot_at, billPrintedAt: order.bill_printed_at } : null,
  );
  ctx.emit('floor', 'table.state', {
    tableId,
    state,
    since: order?.opened_at ?? null,
    amountPaise: order ? (getOrderSnapshot(ctx.db, order.id)?.totals.totalPaise ?? 0) : 0,
    captainId: order?.captain_id ?? null,
  });
}

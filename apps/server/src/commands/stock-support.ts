// Helpers shared by the stock handlers and FireKOT (docs/02 "Stock"). Every balance change is one row in the
// append-only stock_movement ledger plus the cached stock_item.on_hand_milli, in the command's transaction.
import { newId, type StockMovementKind, type StockUnit } from '@dinepos/shared';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

export interface StockItemRow {
  id: string;
  name: string;
  unit: StockUnit;
  on_hand_milli: number;
  reorder_level_milli: number;
  last_unit_cost_paise: number | null;
  active: number;
}

export function loadStockItem(db: Db, id: string): StockItemRow {
  const row = db.prepare('SELECT id, name, unit, on_hand_milli, reorder_level_milli, last_unit_cost_paise, active FROM stock_item WHERE id = ?').get(id) as
    | StockItemRow
    | undefined;
  if (!row) throw new PosError('NOT_FOUND', 'That stock item does not exist.', { stockItemId: id });
  return row;
}

/** Like loadStockItem, but the material must be in use (not switched off). */
export function loadActiveStockItem(db: Db, id: string): StockItemRow {
  const row = loadStockItem(db, id);
  if (row.active !== 1) throw new PosError('INVALID_STATE', `${row.name} is switched off. Switch it on in Stock first.`, { stockItemId: id });
  return row;
}

export interface MovementInput {
  stockItemId: string;
  deltaMilli: number;
  kind: StockMovementKind;
  refType?: 'kot' | 'purchase' | null;
  refId?: string | null;
  reason?: string | null;
  unitCostPaise?: number | null;
}

/** Writes one ledger row and moves the cached balance. Balances may go negative (stock never blocks service). */
export function postMovement(ctx: CommandContext, m: MovementInput): string {
  const id = newId();
  ctx.db
    .prepare(
      `INSERT INTO stock_movement (id, stock_item_id, delta_milli, kind, ref_type, ref_id, reason, unit_cost_paise, business_date, user_id, command_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, m.stockItemId, m.deltaMilli, m.kind, m.refType ?? null, m.refId ?? null, m.reason ?? null, m.unitCostPaise ?? null, ctx.businessDate, ctx.actor.userId, ctx.commandId, ctx.nowIso);
  ctx.db.prepare('UPDATE stock_item SET on_hand_milli = on_hand_milli + ?, updated_at = ? WHERE id = ?').run(m.deltaMilli, ctx.nowIso, m.stockItemId);
  return id;
}

/** Live screens refetch GET /v1/stock. */
export function stockChanged(ctx: CommandContext, stockItemIds: string[]): void {
  ctx.emit('stock', 'stock.changed', { stockItemIds: [...new Set(stockItemIds)] });
}

interface FiredLine {
  id: string;
  item_id: string;
  variant_id: string | null;
  qty: number;
}

/**
 * Material use of the fired lines: the variant's recipe if it has one, else the item's, times the line qty; plus
 * each add-on's recipe times the add-on's qty on the line (already a line total, docs/03 AddItems). Summed per
 * material. Lines without a recipe use nothing.
 */
export function recipeUse(db: Db, orderItemIds: string[]): Map<string, number> {
  const need = new Map<string, number>();
  if (orderItemIds.length === 0) return need;
  const ids = JSON.stringify(orderItemIds);
  const lines = db.prepare('SELECT id, item_id, variant_id, qty FROM order_item WHERE id IN (SELECT value FROM json_each(?))').all(ids) as FiredLine[];
  const recipeOf = db.prepare(
    `SELECT r.stock_item_id, r.qty_milli FROM recipe_line r JOIN stock_item s ON s.id = r.stock_item_id AND s.active = 1
     WHERE r.owner_kind = ? AND r.owner_id = ?`,
  );
  const cache = new Map<string, Array<{ stock_item_id: string; qty_milli: number }>>();
  const recipe = (kind: 'item' | 'variant' | 'addon', id: string) => {
    const key = `${kind}:${id}`;
    let r = cache.get(key);
    if (!r) {
      r = recipeOf.all(kind, id) as Array<{ stock_item_id: string; qty_milli: number }>;
      cache.set(key, r);
    }
    return r;
  };
  const add = (rows: Array<{ stock_item_id: string; qty_milli: number }>, times: number) => {
    for (const r of rows) need.set(r.stock_item_id, (need.get(r.stock_item_id) ?? 0) + r.qty_milli * times);
  };
  const addonsOf = db.prepare('SELECT addon_id, qty FROM order_item_addon WHERE order_item_id = ?');
  for (const l of lines) {
    const own = l.variant_id ? recipe('variant', l.variant_id) : [];
    add(own.length ? own : recipe('item', l.item_id), l.qty);
    for (const a of addonsOf.all(l.id) as Array<{ addon_id: string; qty: number }>) add(recipe('addon', a.addon_id), a.qty);
  }
  return need;
}

/** Called by FireKOT for each KOT: one `sale` movement per material, referenced to the KOT. */
export function consumeForKot(ctx: CommandContext, kotId: string, orderItemIds: string[]): string[] {
  const need = recipeUse(ctx.db, orderItemIds);
  const touched: string[] = [];
  for (const [stockItemId, qty] of [...need].sort(([a], [b]) => a.localeCompare(b))) {
    if (qty <= 0) continue;
    postMovement(ctx, { stockItemId, deltaMilli: -qty, kind: 'sale', refType: 'kot', refId: kotId });
    touched.push(stockItemId);
  }
  return touched;
}

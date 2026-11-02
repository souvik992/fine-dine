import { setRecipeSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { loadActiveStockItem, stockChanged } from './stock-support.js';

const OWNER_TABLE = { item: 'menu_item', variant: 'variant', addon: 'addon' } as const;

/** Replaces the recipe of an item, a variant or an add-on. Recipes are configuration: past movements keep their amounts. */
export const setRecipe = defineCommand({
  type: 'SetRecipe',
  schema: setRecipeSchema,
  right: 'stock.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const owner = db.prepare(`SELECT name FROM ${OWNER_TABLE[p.ownerKind]} WHERE id = ?`).pluck().get(p.ownerId) as string | undefined;
    if (owner === undefined) throw new PosError('NOT_FOUND', `That ${p.ownerKind} does not exist.`, { ownerKind: p.ownerKind, ownerId: p.ownerId });
    for (const l of p.lines) loadActiveStockItem(db, l.stockItemId);

    const before = db.prepare('SELECT stock_item_id AS stockItemId, qty_milli AS qtyMilli FROM recipe_line WHERE owner_kind = ? AND owner_id = ? ORDER BY stock_item_id').all(p.ownerKind, p.ownerId);
    db.prepare('DELETE FROM recipe_line WHERE owner_kind = ? AND owner_id = ?').run(p.ownerKind, p.ownerId);
    const insert = db.prepare('INSERT INTO recipe_line (owner_kind, owner_id, stock_item_id, qty_milli) VALUES (?, ?, ?, ?)');
    for (const l of p.lines) insert.run(p.ownerKind, p.ownerId, l.stockItemId, l.qtyMilli);

    ctx.audit({ entity: 'recipe', entityId: p.ownerId, action: 'recipe.set', before, after: { ownerKind: p.ownerKind, name: owner, lines: p.lines } });
    stockChanged(ctx, [...(before as Array<{ stockItemId: string }>).map((b) => b.stockItemId), ...p.lines.map((l) => l.stockItemId)]);
    return { result: { ownerKind: p.ownerKind, ownerId: p.ownerId, lines: p.lines.length } };
  },
});

import { importRecipesSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { loadActiveStockItem, stockChanged } from './stock-support.js';

const OWNER_TABLE = { item: 'menu_item', variant: 'variant', addon: 'addon' } as const;

/**
 * Recipe bulk upload (Stock › Recipes › Bulk upload): every recipe in the file or none. Each dish, size or add-on in
 * the file gets exactly the recipe given (as SetRecipe does, audited one by one); recipes not in the file stay.
 */
export const importRecipes = defineCommand({
  type: 'ImportRecipes',
  schema: importRecipesSchema,
  right: 'stock.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const names = p.recipes.map((r) => {
      const name = db.prepare(`SELECT name FROM ${OWNER_TABLE[r.ownerKind]} WHERE id = ?`).pluck().get(r.ownerId) as string | undefined;
      if (name === undefined) throw new PosError('NOT_FOUND', `A ${r.ownerKind} in the file is no longer on the menu. Download the recipes again and retry.`, { ownerKind: r.ownerKind, ownerId: r.ownerId });
      for (const l of r.lines) loadActiveStockItem(db, l.stockItemId);
      return name;
    });
    const readLines = db.prepare('SELECT stock_item_id AS stockItemId, qty_milli AS qtyMilli FROM recipe_line WHERE owner_kind = ? AND owner_id = ? ORDER BY stock_item_id');
    const clear = db.prepare('DELETE FROM recipe_line WHERE owner_kind = ? AND owner_id = ?');
    const insert = db.prepare('INSERT INTO recipe_line (owner_kind, owner_id, stock_item_id, qty_milli) VALUES (?, ?, ?, ?)');
    const touched = new Set<string>();
    let changed = 0;
    p.recipes.forEach((r, i) => {
      const before = readLines.all(r.ownerKind, r.ownerId) as Array<{ stockItemId: string; qtyMilli: number }>;
      const after = [...r.lines].sort((a, b) => a.stockItemId.localeCompare(b.stockItemId));
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      clear.run(r.ownerKind, r.ownerId);
      for (const l of r.lines) insert.run(r.ownerKind, r.ownerId, l.stockItemId, l.qtyMilli);
      ctx.audit({ entity: 'recipe', entityId: r.ownerId, action: 'recipe.set', before, after: { ownerKind: r.ownerKind, name: names[i], lines: r.lines }, reason: 'bulk upload' });
      for (const l of [...before, ...r.lines]) touched.add(l.stockItemId);
      changed++;
    });
    if (touched.size) stockChanged(ctx, [...touched]);
    return { result: { recipes: p.recipes.length, changed } };
  },
});

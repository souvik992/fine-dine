import { upsertStockItemSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { postMovement, stockChanged, type StockItemRow } from './stock-support.js';

export const upsertStockItem = defineCommand({
  type: 'UpsertStockItem',
  schema: upsertStockItemSchema,
  right: 'stock.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const before = db.prepare('SELECT id, name, unit, on_hand_milli, reorder_level_milli, last_unit_cost_paise, active FROM stock_item WHERE id = ?').get(p.id) as
      | StockItemRow
      | undefined;
    if (before && before.unit !== p.unit) {
      throw new PosError('INVALID_STATE', `The unit of ${before.name} cannot change. Add a new material instead.`, { unit: before.unit });
    }
    if (p.active) {
      const clash = db.prepare('SELECT name FROM stock_item WHERE name = ? COLLATE NOCASE AND active = 1 AND id <> ?').pluck().get(p.name, p.id) as string | undefined;
      if (clash) throw new PosError('INVALID_STATE', `A material named ${clash} already exists.`, { name: p.name });
    } else if (before?.active === 1) {
      const used = db.prepare('SELECT count(*) FROM recipe_line WHERE stock_item_id = ?').pluck().get(p.id) as number;
      if (used > 0) throw new PosError('INVALID_STATE', `${before.name} is used in ${used} recipe(s). Remove it from them first.`, { recipes: used });
    }

    if (before) {
      db.prepare('UPDATE stock_item SET name = ?, reorder_level_milli = ?, active = ?, updated_at = ? WHERE id = ?').run(p.name, p.reorderLevelMilli, p.active ? 1 : 0, ctx.nowIso, p.id);
    } else {
      db.prepare(
        `INSERT INTO stock_item (id, name, unit, reorder_level_milli, last_unit_cost_paise, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(p.id, p.name, p.unit, p.reorderLevelMilli, p.opening?.unitCostPaise ?? null, p.active ? 1 : 0, ctx.nowIso, ctx.nowIso);
      if (p.opening) {
        postMovement(ctx, { stockItemId: p.id, deltaMilli: p.opening.qtyMilli, kind: 'opening', reason: 'Opening stock', unitCostPaise: p.opening.unitCostPaise });
      }
    }
    const after = { name: p.name, unit: p.unit, reorderLevelMilli: p.reorderLevelMilli, active: p.active, ...(before ? {} : { opening: p.opening }) };
    ctx.audit({ entity: 'stock_item', entityId: p.id, action: before ? 'stock_item.update' : 'stock_item.create', before, after });
    stockChanged(ctx, [p.id]);
    return { result: { id: p.id, created: !before } };
  },
});

import { adjustStockSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { loadActiveStockItem, postMovement, stockChanged } from './stock-support.js';

/** Wastage (removes), physical count (sets the balance) or correction (adds or removes). Audited with the reason. */
export const adjustStock = defineCommand({
  type: 'AdjustStock',
  schema: adjustStockSchema,
  right: 'stock.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const item = loadActiveStockItem(ctx.db, p.stockItemId);
    const delta = p.kind === 'wastage' ? -p.qtyMilli : p.kind === 'count' ? p.qtyMilli - item.on_hand_milli : p.qtyMilli;
    const reason = p.reason ?? (p.kind === 'count' ? 'Physical count' : null);
    if (delta !== 0) postMovement(ctx, { stockItemId: item.id, deltaMilli: delta, kind: p.kind, reason });
    ctx.audit({
      entity: 'stock_item',
      entityId: item.id,
      action: `stock.${p.kind}`,
      before: { onHandMilli: item.on_hand_milli },
      after: { onHandMilli: item.on_hand_milli + delta, deltaMilli: delta },
      reason,
    });
    stockChanged(ctx, [item.id]);
    return { result: { stockItemId: item.id, deltaMilli: delta, onHandMilli: item.on_hand_milli + delta } };
  },
});

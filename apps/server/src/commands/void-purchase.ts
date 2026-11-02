import { voidPurchaseSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { postMovement, stockChanged } from './stock-support.js';

/** Reverses a purchase (it stays on record as void). The last cost falls back to the latest posted purchase, else the opening cost. */
export const voidPurchase = defineCommand({
  type: 'VoidPurchase',
  schema: voidPurchaseSchema,
  right: 'stock.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const purchase = db.prepare('SELECT id, status, supplier_name, total_paise FROM purchase WHERE id = ?').get(p.purchaseId) as
      | { id: string; status: 'posted' | 'void'; supplier_name: string; total_paise: number }
      | undefined;
    if (!purchase) throw new PosError('NOT_FOUND', 'That purchase does not exist.', { purchaseId: p.purchaseId });
    if (purchase.status === 'void') throw new PosError('INVALID_STATE', 'This purchase is already void.', { purchaseId: p.purchaseId });

    db.prepare("UPDATE purchase SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?").run(ctx.actor.userId, ctx.nowIso, p.reason, p.purchaseId);
    const lines = db.prepare('SELECT stock_item_id, qty_milli, unit_cost_paise FROM purchase_line WHERE purchase_id = ? ORDER BY line_no').all(p.purchaseId) as Array<{
      stock_item_id: string;
      qty_milli: number;
      unit_cost_paise: number;
    }>;
    const resetCost = db.prepare(
      `UPDATE stock_item SET last_unit_cost_paise = coalesce(
         (SELECT pl.unit_cost_paise FROM purchase_line pl JOIN purchase pu ON pu.id = pl.purchase_id
          WHERE pl.stock_item_id = @id AND pu.status = 'posted' ORDER BY pu.created_at DESC, pu.id DESC LIMIT 1),
         (SELECT unit_cost_paise FROM stock_movement WHERE stock_item_id = @id AND kind = 'opening' ORDER BY seq DESC LIMIT 1))
       WHERE id = @id`,
    );
    for (const l of lines) {
      postMovement(ctx, { stockItemId: l.stock_item_id, deltaMilli: -l.qty_milli, kind: 'purchase_void', refType: 'purchase', refId: p.purchaseId, reason: p.reason, unitCostPaise: l.unit_cost_paise });
      resetCost.run({ id: l.stock_item_id });
    }
    ctx.audit({ entity: 'purchase', entityId: p.purchaseId, action: 'purchase.void', before: { status: 'posted', totalPaise: purchase.total_paise }, after: { status: 'void' }, reason: p.reason });
    stockChanged(ctx, lines.map((l) => l.stock_item_id));
    return { result: { purchaseId: p.purchaseId } };
  },
});

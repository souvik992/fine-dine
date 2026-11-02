import { recordPurchaseSchema, stockAmount, sumPaise } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { loadActiveStockItem, postMovement, stockChanged } from './stock-support.js';

/** A supplier invoice: adds each line to stock and sets the material's last cost. Immutable once recorded. */
export const recordPurchase = defineCommand({
  type: 'RecordPurchase',
  schema: recordPurchaseSchema,
  right: 'stock.manage',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    if (db.prepare('SELECT 1 FROM purchase WHERE id = ?').get(p.id)) {
      throw new PosError('INVALID_STATE', 'This purchase is already recorded.', { purchaseId: p.id });
    }
    const lines = p.lines.map((l, i) => {
      loadActiveStockItem(db, l.stockItemId);
      return { ...l, lineNo: i + 1, amountPaise: stockAmount(l.qtyMilli, l.unitCostPaise) };
    });
    const total = sumPaise(lines.map((l) => l.amountPaise));
    db.prepare(
      `INSERT INTO purchase (id, supplier_name, supplier_gstin, invoice_no, invoice_date, note, total_paise, business_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(p.id, p.supplierName, p.supplierGstin, p.invoiceNo, p.invoiceDate, p.note, total, ctx.businessDate, ctx.actor.userId, ctx.nowIso);
    const insertLine = db.prepare('INSERT INTO purchase_line (purchase_id, line_no, stock_item_id, qty_milli, unit_cost_paise, amount_paise) VALUES (?, ?, ?, ?, ?, ?)');
    const setCost = db.prepare('UPDATE stock_item SET last_unit_cost_paise = ? WHERE id = ?');
    for (const l of lines) {
      insertLine.run(p.id, l.lineNo, l.stockItemId, l.qtyMilli, l.unitCostPaise, l.amountPaise);
      setCost.run(l.unitCostPaise, l.stockItemId);
      postMovement(ctx, { stockItemId: l.stockItemId, deltaMilli: l.qtyMilli, kind: 'purchase', refType: 'purchase', refId: p.id, unitCostPaise: l.unitCostPaise });
    }
    ctx.audit({ entity: 'purchase', entityId: p.id, action: 'purchase.record', after: { supplierName: p.supplierName, invoiceNo: p.invoiceNo, totalPaise: total, lines } });
    stockChanged(ctx, lines.map((l) => l.stockItemId));
    return { result: { purchaseId: p.id, totalPaise: total } };
  },
});

import { addItemsSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitTableState, orderItemContext, priceAddons, priceItem, reopenIfBilled, requireEditable, writeAddons } from './order-support.js';

export const addItems = defineCommand({
  type: 'AddItems',
  schema: addItemsSchema,
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireEditable(o);
    const { db } = ctx;
    const ictx = orderItemContext(db, o);
    const exists = db.prepare('SELECT 1 FROM order_item WHERE id = ?');
    const insert = db.prepare(
      `INSERT INTO order_item (id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_paise, tax_rate_bp,
                               note, course, status, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?, ?)`,
    );

    const added = p.items.map((line) => {
      if (exists.get(line.id)) throw new PosError('VALIDATION', 'That order line id is already in use.', { orderItemId: line.id });
      const priced = priceItem(db, ictx, line.itemId, line.variantId);
      const addons = priceAddons(db, line.itemId, line.addons);
      insert.run(line.id, o.id, priced.itemId, priced.variantId, priced.nameSnapshot, line.qty, priced.unitPricePaise, priced.taxRateBp, line.note, line.course, ctx.actor.userId, ctx.nowIso);
      writeAddons(db, line.id, addons);
      return { id: line.id, name: priced.nameSnapshot, qty: line.qty, unitPricePaise: priced.unitPricePaise, taxRateBp: priced.taxRateBp, addons };
    });

    reopenIfBilled(ctx, o);
    ctx.audit({ entity: 'order', entityId: o.id, action: 'order.items.add', after: { items: added } });
    emitTableState(ctx, o.table_id);
    return { result: { orderItemIds: added.map((a) => a.id) } };
  },
});

import { removeHeldItemSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { emitTableState, requireEditable } from './order-support.js';
import { requireHeldItem } from './update-held-item.js';

/** A held item never reached the kitchen, so it is removed outright; the audit row keeps what it was. */
export const removeHeldItem = defineCommand({
  type: 'RemoveHeldItem',
  schema: removeHeldItemSchema,
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireEditable(o);
    const item = requireHeldItem(ctx, o.id, p.orderItemId);
    const addons = ctx.db.prepare('SELECT addon_id, name_snapshot, qty, price_paise FROM order_item_addon WHERE order_item_id = ?').all(p.orderItemId);
    ctx.db.prepare('DELETE FROM order_item_addon WHERE order_item_id = ?').run(p.orderItemId);
    ctx.db.prepare('DELETE FROM order_item WHERE id = ?').run(p.orderItemId);
    ctx.audit({ entity: 'order_item', entityId: p.orderItemId, action: 'order.item.remove', before: { ...item, addons } });
    emitTableState(ctx, o.table_id);
    return { result: { orderItemId: p.orderItemId } };
  },
});

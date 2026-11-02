import { updateHeldItemSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { emitTableState, priceAddons, requireEditable, writeAddons } from './order-support.js';

interface HeldItemRow {
  id: string;
  order_id: string;
  item_id: string;
  name_snapshot: string;
  qty: number;
  note: string | null;
  course: number;
  status: 'held' | 'fired' | 'cancelled';
}

/** Loads an item of this order that is still held (fired items change only via Modify/CancelFiredItem). */
export function requireHeldItem(ctx: CommandContext, orderId: string, orderItemId: string): HeldItemRow {
  const row = ctx.db.prepare('SELECT * FROM order_item WHERE id = ? AND order_id = ?').get(orderItemId, orderId) as HeldItemRow | undefined;
  if (!row) throw new PosError('NOT_FOUND', 'That item is not on this order.', { orderItemId });
  if (row.status !== 'held') {
    throw new PosError('INVALID_STATE', `${row.name_snapshot} was already sent to the kitchen; use modify or cancel instead.`, {
      orderItemId,
      status: row.status,
    });
  }
  return row;
}

export const updateHeldItem = defineCommand({
  type: 'UpdateHeldItem',
  schema: updateHeldItemSchema,
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireEditable(o);
    const before = requireHeldItem(ctx, o.id, p.orderItemId);
    const beforeAddons = ctx.db.prepare('SELECT addon_id, qty FROM order_item_addon WHERE order_item_id = ?').all(p.orderItemId);

    const qty = p.qty ?? before.qty;
    const note = p.note === undefined ? before.note : p.note;
    const course = p.course ?? before.course;
    ctx.db.prepare('UPDATE order_item SET qty = ?, note = ?, course = ? WHERE id = ?').run(qty, note, course, p.orderItemId);
    if (p.addons) writeAddons(ctx.db, p.orderItemId, priceAddons(ctx.db, before.item_id, p.addons));

    ctx.audit({
      entity: 'order_item',
      entityId: p.orderItemId,
      action: 'order.item.update',
      before: { qty: before.qty, note: before.note, course: before.course, addons: beforeAddons },
      after: { qty, note, course, ...(p.addons ? { addons: p.addons } : {}) },
    });
    emitTableState(ctx, o.table_id);
    return { result: { orderItemId: p.orderItemId } };
  },
});

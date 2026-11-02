import { moveTableSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitTableState } from './order-support.js';
import { firedItemsOf, loadOrder, requireLive, sendMoveNotices, tableLabel } from './table-support.js';

/**
 * Moves the order to a free table (docs/03). Prices and KOTs stay as they were (snapshots); every station that
 * has sent items gets a "MOVED T4 -> T9" notice. Leakage flag once a KOT exists.
 */
export const moveTable = defineCommand({
  type: 'MoveTable',
  schema: moveTableSchema,
  right: 'table.move',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireLive(o, 'This order');
    const { db } = ctx;
    if (o.table_id === p.toTableId) throw new PosError('INVALID_STATE', 'The order is already on that table.', { tableId: p.toTableId });
    const to = db.prepare('SELECT id, label, status, open_order_id FROM dining_table WHERE id = ?').get(p.toTableId) as
      | { id: string; label: string; status: 'active' | 'reserved' | 'blocked'; open_order_id: string | null }
      | undefined;
    if (!to) throw new PosError('NOT_FOUND', 'Table not found.', { tableId: p.toTableId });
    if (to.status === 'blocked') throw new PosError('INVALID_STATE', `Table ${to.label} is blocked.`, { tableId: to.id });
    if (to.open_order_id) throw new PosError('INVALID_STATE', `Table ${to.label} is occupied. Use Merge to join the two tables.`, { tableId: to.id, orderId: to.open_order_id });

    const fromLabel = tableLabel(ctx, o.table_id);
    if (o.table_id) db.prepare('UPDATE dining_table SET open_order_id = NULL WHERE id = ?').run(o.table_id); // first: open_order_id is unique
    db.prepare('UPDATE dining_table SET open_order_id = ? WHERE id = ?').run(o.id, to.id);
    db.prepare('UPDATE "order" SET table_id = ? WHERE id = ?').run(to.id, o.id);

    const fired = firedItemsOf(ctx, o.id);
    const notices = sendMoveNotices(ctx, loadOrder(ctx, o.id), fired, `MOVED ${fromLabel} -> ${to.label}`, false);
    ctx.audit({
      entity: 'order',
      entityId: o.id,
      action: 'order.move_table',
      before: { tableId: o.table_id, table: fromLabel },
      after: { tableId: to.id, table: to.label, noticeKotNos: notices },
      leakage: fired.length > 0,
    });
    emitTableState(ctx, o.table_id);
    emitTableState(ctx, to.id);
    return { result: { fromTableId: o.table_id, toTableId: to.id, noticeKotNos: notices } };
  },
});

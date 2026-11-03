import { newId, openTableSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { defaultCaptain } from './captain-support.js';
import { emitTableState } from './order-support.js';

export const openTable = defineCommand({
  type: 'OpenTable',
  schema: openTableSchema,
  right: 'order.create',
  needsOrder: false,
  apply(ctx, p) {
    const { db } = ctx;
    const table = db.prepare('SELECT id, label, status, open_order_id FROM dining_table WHERE id = ?').get(p.tableId) as
      | { id: string; label: string; status: 'active' | 'reserved' | 'blocked'; open_order_id: string | null }
      | undefined;
    if (!table) throw new PosError('NOT_FOUND', 'Table not found.', { tableId: p.tableId });
    if (table.status === 'blocked') throw new PosError('INVALID_STATE', `Table ${table.label} is blocked.`, { tableId: p.tableId });
    if (table.open_order_id) {
      throw new PosError('INVALID_STATE', `Table ${table.label} is already occupied.`, { tableId: p.tableId, orderId: table.open_order_id });
    }
    if (p.captainId && !db.prepare('SELECT 1 FROM app_user WHERE id = ? AND active = 1').get(p.captainId)) {
      throw new PosError('NOT_FOUND', 'Captain not found.', { captainId: p.captainId });
    }
    // Nobody named: the captain whose section holds this table (P3-04).
    const captainId = p.captainId ?? defaultCaptain(db, table.id);
    const orderId = p.orderId ?? newId();
    if (db.prepare('SELECT 1 FROM "order" WHERE id = ?').get(orderId)) {
      throw new PosError('INVALID_STATE', 'That order id is already in use.', { orderId });
    }

    db.prepare(
      `INSERT INTO "order" (id, business_date, table_id, type, covers, captain_id, state, version, opened_at, opened_by)
       VALUES (?, ?, ?, 'dine_in', ?, ?, 'open', 1, ?, ?)`,
    ).run(orderId, ctx.businessDate, table.id, p.covers, captainId, ctx.nowIso, ctx.actor.userId);
    db.prepare('UPDATE dining_table SET open_order_id = ? WHERE id = ?').run(orderId, table.id);

    ctx.audit({ entity: 'order', entityId: orderId, action: 'order.open', after: { tableId: table.id, covers: p.covers, captainId } });
    emitTableState(ctx, table.id);
    return { orderId, result: { orderId } };
  },
});

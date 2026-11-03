import { newId, openTableSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { defaultCaptain } from './captain-support.js';
import { emitTableState } from './order-support.js';
import { holdingBooking, refuseIfHeld } from './reservation-support.js';

export interface OpenOrderOptions {
  tableId: string;
  covers: number;
  captainId?: string | null;
  orderId?: string;
  /** Seat a walk-in on a table held for a booking anyway (P4-04). */
  ignoreReservation?: boolean;
  /** Seating this booking: its own hold does not count (P4-04). */
  forReservationId?: string;
}

/**
 * Opens a dine-in order on a free table (OpenTable, and seating a booking or a waitlist guest). Audited as
 * `order.open`; the table turns SEATED.
 */
export function openOrderOnTable(ctx: CommandContext, o: OpenOrderOptions): { orderId: string; tableLabel: string } {
  const { db } = ctx;
  const table = db.prepare('SELECT id, label, status, open_order_id FROM dining_table WHERE id = ?').get(o.tableId) as
    | { id: string; label: string; status: 'active' | 'reserved' | 'blocked'; open_order_id: string | null }
    | undefined;
  if (!table) throw new PosError('NOT_FOUND', 'Table not found.', { tableId: o.tableId });
  if (table.status === 'blocked') throw new PosError('INVALID_STATE', `Table ${table.label} is blocked.`, { tableId: o.tableId });
  if (table.open_order_id) {
    throw new PosError('INVALID_STATE', `Table ${table.label} is already occupied.`, { tableId: o.tableId, orderId: table.open_order_id });
  }
  if (!o.ignoreReservation) refuseIfHeld(ctx, table, o.forReservationId);
  const overrode = o.ignoreReservation ? holdingBooking(db, table.id, ctx.now, o.forReservationId) : null;
  if (o.captainId && !db.prepare('SELECT 1 FROM app_user WHERE id = ? AND active = 1').get(o.captainId)) {
    throw new PosError('NOT_FOUND', 'Captain not found.', { captainId: o.captainId });
  }
  // Nobody named: the captain whose section holds this table (P3-04).
  const captainId = o.captainId ?? defaultCaptain(db, table.id);
  const orderId = o.orderId ?? newId();
  if (db.prepare('SELECT 1 FROM "order" WHERE id = ?').get(orderId)) {
    throw new PosError('INVALID_STATE', 'That order id is already in use.', { orderId });
  }

  db.prepare(
    `INSERT INTO "order" (id, business_date, table_id, type, covers, captain_id, state, version, opened_at, opened_by)
     VALUES (?, ?, ?, 'dine_in', ?, ?, 'open', 1, ?, ?)`,
  ).run(orderId, ctx.businessDate, table.id, o.covers, captainId, ctx.nowIso, ctx.actor.userId);
  db.prepare('UPDATE dining_table SET open_order_id = ? WHERE id = ?').run(orderId, table.id);

  ctx.audit({
    entity: 'order',
    entityId: orderId,
    action: 'order.open',
    after: {
      tableId: table.id,
      covers: o.covers,
      captainId,
      ...(o.forReservationId ? { reservationId: o.forReservationId } : {}),
      // Seated over someone's booking ("Seat anyway"): whose, so it can be checked later.
      ...(overrode ? { overBookingId: overrode.id, overBookingGuest: overrode.guest_name } : {}),
    },
  });
  emitTableState(ctx, table.id);
  return { orderId, tableLabel: table.label };
}

export const openTable = defineCommand({
  type: 'OpenTable',
  schema: openTableSchema,
  right: 'order.create',
  needsOrder: false,
  apply(ctx, p) {
    const { orderId } = openOrderOnTable(ctx, { tableId: p.tableId, covers: p.covers, captainId: p.captainId, orderId: p.orderId, ignoreReservation: p.ignoreReservation });
    return { orderId, result: { orderId } };
  },
});

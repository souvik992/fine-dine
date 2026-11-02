// Shared by ModifyFiredItem and CancelFiredItem: find the fired line, send a change slip to its station.
import type { KotKind } from '@dinepos/printing';
import type { OrderRow } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { issueKot, kotHeader } from './kot-support.js';
import { returnToStock, stockChanged, type UseLine } from './stock-support.js';

export interface FiredLine {
  id: string;
  item_id: string;
  variant_id: string | null;
  name_snapshot: string;
  qty: number;
  unit_price_paise: number;
  tax_rate_bp: number;
  note: string | null;
  course: number;
  station_id: string;
  kot_id: string;
  kot_no: number;
  added_by: string | null;
  added_at: string;
  original_order_id: string | null;
}

/** The fired line of this order; INVALID_STATE when it is held or already cancelled. */
export function loadFiredLine(ctx: CommandContext, order: OrderRow, orderItemId: string): FiredLine {
  const row = ctx.db
    .prepare(
      `SELECT i.*, i.status, k.kot_no FROM order_item i LEFT JOIN kot k ON k.id = i.kot_id WHERE i.id = ? AND i.order_id = ?`,
    )
    .get(orderItemId, order.id) as (FiredLine & { status: string }) | undefined;
  if (!row) throw new PosError('NOT_FOUND', 'That item is not on this order.', { orderItemId });
  if (row.status === 'held') throw new PosError('INVALID_STATE', 'This item has not been sent to the kitchen yet; change it in the cart.', { orderItemId });
  if (row.status !== 'fired') throw new PosError('INVALID_STATE', 'This item is already cancelled.', { orderItemId });
  return row;
}

/**
 * Sends the change slip (`-qty name`, what is left, the KOT it changes, the reason) to the line's station and,
 * when "not prepared", returns the portions' ingredients to stock. Returns the slip.
 */
export function sendChangeSlip(
  ctx: CommandContext,
  order: OrderRow,
  line: FiredLine,
  change: { kind: Extract<KotKind, 'modify' | 'cancel'>; removedQty: number; nowQty: number | null; reason: string; stock: UseLine | null },
): { id: string; kotNo: number } {
  const station = ctx.db.prepare('SELECT id, name FROM station WHERE id = ?').get(line.station_id) as { id: string; name: string };
  const addons = ctx.db.prepare('SELECT name_snapshot AS name, qty FROM order_item_addon WHERE order_item_id = ? ORDER BY name_snapshot').all(line.id) as Array<{
    name: string;
    qty: number;
  }>;
  const slip = issueKot(
    ctx,
    order,
    station,
    change.kind,
    [{ qty: -change.removedQty, nowQty: change.nowQty, name: line.name_snapshot, course: line.course, note: line.note, addons: change.kind === 'cancel' ? addons : [] }],
    kotHeader(ctx, order),
    { forKotNo: line.kot_no, reason: change.reason },
  );
  if (change.stock) {
    const touched = returnToStock(ctx, slip.id, [change.stock], `KOT ${slip.kotNo}, ${change.reason}`);
    if (touched.length) stockChanged(ctx, touched);
  }
  return { id: slip.id, kotNo: slip.kotNo };
}

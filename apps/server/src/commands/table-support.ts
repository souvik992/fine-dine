// Shared by MoveTable, MergeTables and TransferItems (P2-03). Orders move between tables; KOT rows stay with the
// order they were fired for and fired items keep their kot_id (docs/02 invariant 7).
import type { KotTicketLine } from '@dinepos/printing';
import type { OrderRow } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { issueKot, kotHeader } from './kot-support.js';
import { reopenIfBilled } from './order-support.js';

export function loadOrder(ctx: CommandContext, orderId: string): OrderRow {
  const o = ctx.db.prepare('SELECT * FROM "order" WHERE id = ?').get(orderId) as OrderRow | undefined;
  if (!o) throw new PosError('NOT_FOUND', 'That order does not exist.', { orderId });
  return o;
}

/** Open or billed (not settled, void or merged). */
export function requireLive(o: OrderRow, label: string): void {
  if (o.state !== 'open' && o.state !== 'billed') throw new PosError('INVALID_STATE', `${label} is ${o.state}; it can no longer be changed.`, { orderId: o.id, state: o.state });
}

export function tableLabel(ctx: CommandContext, tableId: string | null): string {
  if (!tableId) return 'Takeaway';
  return (ctx.db.prepare('SELECT label FROM dining_table WHERE id = ?').pluck().get(tableId) as string | undefined) ?? '?';
}

/** Another order this command changed: version + 1, and its printed bill is superseded (like adding items). */
export function touchOther(ctx: CommandContext, o: OrderRow): void {
  reopenIfBilled(ctx, o);
  ctx.touchOrder(o.id);
}

export interface FiredMove {
  station_id: string;
  qty: number;
  name: string;
  course: number;
  note: string | null;
}

/**
 * One `move_notice` slip per station that has sent items involved, so the kitchen and runners send food to the right
 * table. `withLines`: list the moved items (TransferItems); otherwise the header says it all (MoveTable, MergeTables).
 */
export function sendMoveNotices(ctx: CommandContext, headerOrder: OrderRow, fired: FiredMove[], notice: string, withLines: boolean): number[] {
  const byStation = new Map<string, FiredMove[]>();
  for (const f of fired) byStation.set(f.station_id, [...(byStation.get(f.station_id) ?? []), f]);
  if (byStation.size === 0) return [];
  const header = { ...kotHeader(ctx, headerOrder), notice };
  const stations = ctx.db.prepare(`SELECT id, name FROM station WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name COLLATE NOCASE, id`).all(JSON.stringify([...byStation.keys()])) as Array<{
    id: string;
    name: string;
  }>;
  return stations.map((station) => {
    const lines: KotTicketLine[] = withLines ? byStation.get(station.id)!.map((f) => ({ qty: f.qty, name: f.name, course: f.course, note: f.note, addons: [] })) : [];
    return issueKot(ctx, headerOrder, station, 'move_notice', lines, header).kotNo;
  });
}

/** Sent (not cancelled) items of an order, for its move notices. */
export function firedItemsOf(ctx: CommandContext, orderId: string): FiredMove[] {
  return ctx.db
    .prepare(`SELECT station_id, qty, name_snapshot AS name, course, note FROM order_item WHERE order_id = ? AND status = 'fired' AND station_id IS NOT NULL ORDER BY added_at, rowid`)
    .all(orderId) as FiredMove[];
}

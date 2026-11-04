// Kitchen display (P4-02, docs/06 "KDS"): a KOT moves new → ready → served. These change timestamps only; they never
// touch the order's version, so bumping in the kitchen cannot conflict with a captain or a terminal.
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';

export interface KotRow {
  id: string;
  order_id: string;
  station_id: string;
  kot_no: number;
  kind: string;
  ready_at: string | null;
  served_at: string | null;
}

export type KotStatus = 'new' | 'ready' | 'served';

export function requireKot(ctx: CommandContext, kotId: string): KotRow {
  const kot = ctx.db.prepare('SELECT id, order_id, station_id, kot_no, kind, ready_at, served_at FROM kot WHERE id = ?').get(kotId) as KotRow | undefined;
  if (!kot) throw new PosError('NOT_FOUND', 'That kitchen ticket was not found.', { kotId });
  return kot;
}

export const kotLabel = (kot: KotRow) => `KOT ${String(kot.kot_no).padStart(4, '0')}`;

/** Audits the change and tells the kitchen screens, the order's viewers and the floor. */
export function kotStatusChanged(ctx: CommandContext, kot: KotRow, status: KotStatus, action: string, before: Record<string, unknown>): void {
  ctx.audit({ entity: 'kot', entityId: kot.id, action, before, after: { status, kotNo: kot.kot_no, at: ctx.nowIso } });
  ctx.emit([`station:${kot.station_id}`, `order:${kot.order_id}`, 'kds', 'floor'], 'kot.status', { kotId: kot.id, orderId: kot.order_id, stationId: kot.station_id, status });
}

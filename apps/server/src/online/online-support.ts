// Online orders (P4-06): the stored hub orders, the action outbox and the hub link, as the commands use them.
import type { HubOrder, HubOrderState, OnlineOrderView } from '@dinepos/shared';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

export interface OnlineOrderRow {
  id: string;
  number: string;
  state: HubOrderState;
  order_json: string;
  received_at: string;
  updated_at: string;
  local_order_id: string | null;
  bill_id: string | null;
  pos_total_paise: number | null;
  prep_minutes: number | null;
  alert: string | null;
}

export interface LinkRow {
  hub_url: string | null;
  device_key: string | null;
  store_slug: string | null;
  store_name: string | null;
  last_seq: number;
  menu_hash: string | null;
  menu_version: number;
}

export const linkRow = (db: Db): LinkRow => db.prepare('SELECT * FROM online_link WHERE id = 1').get() as LinkRow;

export function findOnline(db: Db, id: string): OnlineOrderRow | undefined {
  return db.prepare('SELECT * FROM online_order WHERE id = ?').get(id) as OnlineOrderRow | undefined;
}

export function requireOnline(ctx: CommandContext, id: string): OnlineOrderRow {
  const o = findOnline(ctx.db, id);
  if (!o) throw new PosError('NOT_FOUND', 'That online order was not found.', { onlineOrderId: id });
  return o;
}

export const hubOrder = (o: OnlineOrderRow) => JSON.parse(o.order_json) as HubOrder;

/** Changes the order's state (and what staff must know); the screens refresh. */
export function setOnlineState(ctx: CommandContext, id: string, state: HubOrderState, patch: { alert?: string | null; prepMinutes?: number; etaAt?: number; rider?: HubOrder['rider']; reasonText?: string | null } = {}): void {
  const o = requireOnline(ctx, id);
  const order = hubOrder(o);
  const next: HubOrder = {
    ...order,
    state,
    ...(patch.etaAt !== undefined ? { etaAt: patch.etaAt } : {}),
    ...(patch.rider !== undefined ? { rider: patch.rider } : {}),
    ...(patch.reasonText !== undefined ? { reasonText: patch.reasonText } : {}),
    ...(patch.prepMinutes !== undefined ? { prepMinutes: patch.prepMinutes } : {}),
  };
  ctx.db
    .prepare('UPDATE online_order SET state = ?, order_json = ?, updated_at = ?, alert = ?, prep_minutes = coalesce(?, prep_minutes) WHERE id = ?')
    .run(state, JSON.stringify(next), ctx.nowIso, patch.alert === undefined ? o.alert : patch.alert, patch.prepMinutes ?? null, id);
  onlineChanged(ctx, id);
}

/** An action for the hub, stored now and sent after commit (retried with the same key until the hub answers). */
export function enqueueHubAction(ctx: CommandContext, orderId: string, action: 'received' | 'accept' | 'reject' | 'state', body: Record<string, unknown>, idemKey: string): void {
  ctx.db
    .prepare('INSERT OR IGNORE INTO online_outbox (order_id, action, body_json, idem_key, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(orderId, action, JSON.stringify(body), idemKey, ctx.nowIso);
  ctx.emit('online', 'online.outbox', { orderId, action });
}

export function onlineChanged(ctx: CommandContext, orderId: string): void {
  ctx.emit('online', 'online.changed', { onlineOrderId: orderId });
}

/** For the screens. */
export function onlineView(db: Db, o: OnlineOrderRow): OnlineOrderView {
  const billNo = o.bill_id ? ((db.prepare('SELECT bill_no_text FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').pluck().get(o.bill_id) as string | undefined) ?? null) : null;
  return {
    id: o.id,
    number: o.number,
    state: o.state,
    order: hubOrder(o),
    receivedAt: o.received_at,
    localOrderId: o.local_order_id,
    billId: o.bill_id,
    billNo,
    posTotalPaise: o.pos_total_paise,
    prepMinutes: o.prep_minutes,
    alert: o.alert,
  };
}

/** "W-1042 · PICKUP" for the KOT and the bill of an online order's DinePOS order. */
export function onlineRef(db: Db, localOrderId: string): string | null {
  const r = db.prepare('SELECT number, order_json FROM online_order WHERE local_order_id = ?').get(localOrderId) as { number: string; order_json: string } | undefined;
  if (!r) return null;
  const o = JSON.parse(r.order_json) as HubOrder;
  const pay = o.payment === 'COD' ? (o.fulfilment === 'DELIVERY' ? 'CASH ON DELIVERY' : 'PAY AT PICKUP') : 'PAID ONLINE';
  return `${r.number} · ${o.fulfilment === 'DELIVERY' ? 'DELIVERY' : 'PICKUP'} · ${pay}`;
}

/** The customer's note for the whole order ("Allergic to peanuts"), for the KOT; null when none. */
export function onlineNote(db: Db, localOrderId: string): string | null {
  const json = db.prepare('SELECT order_json FROM online_order WHERE local_order_id = ?').pluck().get(localOrderId) as string | undefined;
  const note = json ? (JSON.parse(json) as HubOrder).note?.trim() : null;
  return note ? note.slice(0, 300) : null;
}

// Pure helpers for the Online orders screen (P4-06, tested).
import type { HubOrderState, OnlineOrderView } from '@dinepos/shared';

export type Column = 'new' | 'kitchen' | 'ready' | 'out' | 'done';

const COLUMN: Record<HubOrderState, Column> = {
  PLACED: 'new',
  PAYMENT_PENDING: 'new',
  PAYMENT_FAILED: 'done',
  SENT_TO_STORE: 'new',
  RECEIVED: 'new',
  ACCEPTED: 'kitchen',
  PREPARING: 'kitchen',
  READY: 'ready',
  OUT_FOR_DELIVERY: 'out',
  DELIVERED: 'done',
  PICKED_UP: 'done',
  REJECTED: 'done',
  AUTO_REJECTED: 'done',
  CANCELLED: 'done',
};

export const STATE_LABEL: Record<HubOrderState, string> = {
  PLACED: 'Placed',
  PAYMENT_PENDING: 'Awaiting payment',
  PAYMENT_FAILED: 'Payment failed',
  SENT_TO_STORE: 'New',
  RECEIVED: 'New',
  ACCEPTED: 'Accepted',
  PREPARING: 'Being prepared',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  PICKED_UP: 'Collected',
  REJECTED: 'Rejected',
  AUTO_REJECTED: 'Missed (not accepted in time)',
  CANCELLED: 'Cancelled',
};

export const REJECT_LABEL = {
  ITEM_UNAVAILABLE: 'A dish is not available',
  TOO_BUSY: 'Too busy right now',
  CLOSING: 'Closing soon',
  OUT_OF_DELIVERY_AREA: 'Outside our delivery area',
  OTHER: 'Other reason',
} as const;

/** The board: orders by column, oldest first (new ones at the top of New are the most urgent). */
export function board(orders: readonly OnlineOrderView[]): Record<Column, OnlineOrderView[]> {
  const out: Record<Column, OnlineOrderView[]> = { new: [], kitchen: [], ready: [], out: [], done: [] };
  for (const o of orders) out[COLUMN[o.state]].push(o);
  for (const k of Object.keys(out) as Column[]) out[k].sort((a, b) => (k === 'done' ? b.receivedAt.localeCompare(a.receivedAt) : a.receivedAt.localeCompare(b.receivedAt)));
  return out;
}

/** What the store can do next (contract rules for the POS, own riders). */
type Step = 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'PICKED_UP';
const STEPS: Partial<Record<HubOrderState, { PICKUP: Step[]; DELIVERY: Step[] }>> = {
  ACCEPTED: { PICKUP: ['PREPARING', 'READY'], DELIVERY: ['PREPARING', 'READY'] },
  PREPARING: { PICKUP: ['READY'], DELIVERY: ['READY'] },
  READY: { PICKUP: ['PICKED_UP'], DELIVERY: ['OUT_FOR_DELIVERY'] },
  OUT_FOR_DELIVERY: { PICKUP: [], DELIVERY: ['DELIVERED'] },
};

export function nextSteps(o: Pick<OnlineOrderView, 'state'> & { order: { fulfilment: 'PICKUP' | 'DELIVERY' } }): Step[] {
  return STEPS[o.state]?.[o.order.fulfilment] ?? [];
}

/** "4:32 left" until the hub rejects an unanswered order (manual mode), or null. */
export function timeLeft(acceptBy: number | null, nowMs: number): { text: string; urgent: boolean } | null {
  if (acceptBy === null) return null;
  const s = Math.max(0, Math.floor((acceptBy - nowMs) / 1000));
  return { text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left`, urgent: s < 60 };
}

/** New orders waiting for an answer (the header badge). */
export const waitingCount = (orders: readonly OnlineOrderView[]) => orders.filter((o) => o.state === 'SENT_TO_STORE' || o.state === 'RECEIVED').length;

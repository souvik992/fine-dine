// Takeaway and delivery orders on the floor (no table): how they are named and shown. Pure, no React.
import type { CounterOrder, OrderSnapshot } from '@dinepos/shared';

export type CounterType = CounterOrder['type'];

export const COUNTER_TYPE_LABEL: Record<CounterType, string> = {
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

/** Where the order is, in the tile colours the tables use (colour is never the only signal: the label says it too). */
export const STAGE_META: Record<CounterOrder['stage'], { label: string; className: string }> = {
  new: { label: 'Taking order', className: 'tile-seated' },
  kitchen: { label: 'In the kitchen', className: 'tile-kot' },
  ready: { label: 'Food ready', className: 'tile-ready' },
  served: { label: 'Served · print bill', className: 'tile-served' },
  billed: { label: 'Billed · to pay', className: 'tile-bill' },
};

/** "Takeaway #12", "Delivery #5"; a dine-in order is named by its table. */
export function orderTitle(o: Pick<OrderSnapshot, 'type' | 'table' | 'ticketNo'>): string {
  if (o.table) return `Table ${o.table.label}`;
  const kind = o.type === 'delivery' ? 'Delivery' : o.type === 'online' ? 'Online order' : 'Takeaway';
  return o.ticketNo ? `${kind} #${o.ticketNo}` : kind;
}

/** True for an order with no table that was opened from the floor as a takeaway or delivery. */
export const isCounterOrder = (o: Pick<OrderSnapshot, 'type' | 'table'>): boolean => !o.table && (o.type === 'takeaway' || o.type === 'delivery');

/** Only digits, +, spaces and hyphens (what the server accepts), at most 17 characters. */
export const cleanPhone = (v: string): string => v.replace(/[^0-9+\- ]/g, '').slice(0, 17);

/** The phone rule the bill uses too: optional +, then 6 to 16 digits, spaces or hyphens. */
const PHONE = /^\+?[0-9 -]{6,16}$/;

/** What stops the dialog from opening the order, or null when it can. */
export function counterFormError(type: CounterType, f: { phone: string; address: string }): string | null {
  const phone = f.phone.trim();
  if (phone && !PHONE.test(phone)) return 'That phone number does not look right (6 to 16 digits).';
  if (type !== 'delivery') return null;
  if (!phone) return 'Enter the customer’s phone number for the rider.';
  if (!f.address.trim()) return 'Enter the delivery address.';
  return null;
}

/** Counter orders of one type, or all of them; oldest first as the server sends them. */
export function counterOrdersOf(list: CounterOrder[] | undefined, filter: CounterType | 'all'): CounterOrder[] {
  return (list ?? []).filter((o) => filter === 'all' || o.type === filter);
}

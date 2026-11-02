// Which command a cart action becomes, decided on the latest order snapshot (pure + tested).
import type { OrderSnapshot } from '@dinepos/shared';

/** Largest quantity on one line (AddItems / UpdateHeldItem schema). */
export const MAX_LINE_QTY = 999;

export interface NewLine {
  id: string;
  itemId: string;
  variantId: string | null;
  qty: number;
  addons: Array<{ addonId: string; qty: number }>;
  note: string | null;
  course: number;
}

export type LineCommand = { type: 'AddItems'; payload: { items: NewLine[] } } | { type: 'UpdateHeldItem'; payload: { orderItemId: string; qty: number } };

const addonKey = (addons: ReadonlyArray<{ addonId: string; qty: number }>) =>
  addons
    .map((a) => `${a.addonId}x${a.qty}`)
    .sort()
    .join(',');

/**
 * Adding an item that is already waiting in the cart (not yet sent to the kitchen) with the same size, add-ons,
 * note and course raises that line's quantity instead of adding a second line. Lines already fired are never
 * changed: the kitchen gets the extra on a new KOT.
 */
export function addOrMerge(order: Pick<OrderSnapshot, 'items'>, line: NewLine): LineCommand {
  const key = addonKey(line.addons);
  const same = order.items.find(
    (i) =>
      i.status === 'held' &&
      i.itemId === line.itemId &&
      (i.variantId ?? null) === line.variantId &&
      (i.note ?? null) === (line.note || null) &&
      i.course === line.course &&
      addonKey(i.addons) === key &&
      i.qty + line.qty <= MAX_LINE_QTY,
  );
  if (same) return { type: 'UpdateHeldItem', payload: { orderItemId: same.id, qty: same.qty + line.qty } };
  return { type: 'AddItems', payload: { items: [line] } };
}

/**
 * + / − on a held line, applied to its quantity at send time, so quick presses add up instead of repeating the
 * same number. Null when there is nothing to do (line gone, already fired, or it would go below 1).
 */
export function changeBy(order: Pick<OrderSnapshot, 'items'>, orderItemId: string, delta: number): LineCommand | null {
  const line = order.items.find((i) => i.id === orderItemId && i.status === 'held');
  if (!line) return null;
  const qty = Math.min(MAX_LINE_QTY, line.qty + delta);
  if (qty < 1 || qty === line.qty) return null;
  return { type: 'UpdateHeldItem', payload: { orderItemId, qty } };
}

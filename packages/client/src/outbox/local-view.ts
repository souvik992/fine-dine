// What the phone shows for an order: the last snapshot from the server plus the changes still in the outbox
// (pure). Names and prices of waiting dishes come from the cached menu; totals use the same calculator as the server.
import { calculateBill, type MenuSnapshot, type OrderItemSnapshot, type OrderSnapshot } from '@dinepos/shared';
import type { OutboxEntry } from './outbox.js';

export interface ViewItem extends OrderItemSnapshot {
  /** Added or changed on this phone, not on the server yet. */
  waiting?: true;
  /** Fired on this phone while offline: "Queued — not in the kitchen yet". */
  queuedFire?: true;
}

export interface OrderView extends Omit<OrderSnapshot, 'items'> {
  items: ViewItem[];
  /** Changes for this order still in the outbox (queued or needing attention). */
  waiting: number;
  attention: number;
}

interface AddLine {
  id: string;
  itemId: string;
  variantId?: string | null;
  qty: number;
  addons?: Array<{ addonId: string; qty: number }>;
  note?: string | null;
  course?: number;
}

function newItem(menu: MenuSnapshot | undefined, l: AddLine): ViewItem {
  const item = menu?.items.find((i) => i.id === l.itemId);
  const variant = l.variantId ? item?.variants.find((v) => v.id === l.variantId) : undefined;
  const addonById = new Map(menu?.addonGroups.flatMap((g) => g.addons).map((a) => [a.id, a]) ?? []);
  return {
    id: l.id,
    itemId: l.itemId,
    ...(l.variantId ? { variantId: l.variantId } : {}),
    name: item ? (variant ? `${item.name} (${variant.name})` : item.name) : 'Dish',
    qty: l.qty,
    unitPricePaise: variant?.pricePaise ?? item?.pricePaise ?? 0,
    taxRateBp: item?.taxRateBp ?? 0,
    addons: (l.addons ?? []).map((a) => ({ addonId: a.addonId, qty: a.qty, name: addonById.get(a.addonId)?.name ?? 'Add-on', pricePaise: addonById.get(a.addonId)?.pricePaise ?? 0 })),
    ...(l.note ? { note: l.note } : {}),
    course: l.course ?? 1,
    status: 'held',
    waiting: true,
  };
}

/**
 * The order as the captain should see it. Null when there is nothing to show (no snapshot and no OpenTable waiting).
 * `version` is the version the next change should be decided on: the server's plus one per waiting change.
 */
export function orderView(orderId: string, base: OrderSnapshot | null | undefined, entries: readonly OutboxEntry[], menu: MenuSnapshot | undefined): OrderView | null {
  const mine = entries.filter((e) => e.orderId === orderId);
  const open = mine.find((e) => e.type === 'OpenTable');
  let view: OrderView;
  if (base) view = { ...base, items: base.items.map((i) => ({ ...i })), waiting: 0, attention: 0 };
  else if (open)
    view = {
      id: orderId,
      version: 1,
      state: 'open',
      type: 'dine_in',
      businessDate: '',
      table: { id: open.table.id, label: open.table.label, areaId: open.table.areaId ?? '' },
      covers: open.payload.covers as number,
      openedAt: open.queuedAt,
      items: [],
      kots: [],
      bills: [],
      totals: { subtotalPaise: 0, taxPaise: 0, totalPaise: 0 },
      waiting: 0,
      attention: 0,
    };
  else return null;

  for (const e of mine) {
    view.waiting++;
    if (e.status === 'attention') view.attention++;
    if (e.type === 'OpenTable') continue;
    const p = e.payload;
    const find = (id: unknown) => view.items.find((i) => i.id === id);
    if (e.type === 'AddItems') view.items.push(...(p.items as AddLine[]).filter((l) => !find(l.id)).map((l) => newItem(menu, l)));
    else if (e.type === 'UpdateHeldItem') {
      const i = find(p.orderItemId);
      if (i && i.status === 'held') {
        if (typeof p.qty === 'number') i.qty = p.qty;
        if (typeof p.course === 'number') i.course = p.course;
        if (p.note !== undefined) i.note = (p.note as string | null) ?? undefined;
        i.waiting = true;
      }
    } else if (e.type === 'RemoveHeldItem') view.items = view.items.filter((i) => i.id !== p.orderItemId || i.status !== 'held');
    else if (e.type === 'FireKOT') {
      const ids = Array.isArray(p.itemIds) ? new Set(p.itemIds as string[]) : null;
      for (const i of view.items) {
        if (i.status !== 'held') continue;
        if (ids ? ids.has(i.id) : typeof p.course === 'number' ? i.course === p.course : true) {
          // Counts as sent for every later decision (no merging into it, no more changes), without a KOT number yet.
          i.status = 'fired';
          i.queuedFire = true;
        }
      }
    } else if (e.type === 'SetCovers') view.covers = p.covers as number;
    else if (e.type === 'RequestBill') view.billRequest = { at: e.queuedAt, byName: e.by.name };
  }
  // Each accepted change adds one to the version; a new order starts at 1.
  view.version = (base?.version ?? 1) + mine.filter((e) => e.type !== 'OpenTable').length;

  if (mine.length) {
    const live = view.items.filter((i) => i.status !== 'cancelled');
    const calc = calculateBill(
      live.map((i) => ({ id: i.id, qty: i.qty, unitPricePaise: i.unitPricePaise, taxRateBp: i.taxRateBp, addons: i.addons })),
      { pricingMode: menu?.pricingMode ?? 'exclusive', roundOffStep: 0 },
    );
    view.totals = { subtotalPaise: calc.subtotal, taxPaise: calc.totalTax, totalPaise: calc.total };
  }
  return view;
}

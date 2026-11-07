// What DinePOS publishes to the order hub (PUT /v1/pos/menu, contract `PublishedMenu`) and how it prices an online
// order itself before accepting (P4-06). Pure apart from reading the menu and settings.
import { createHash } from 'node:crypto';
import { calculateBill, isPlatformOrder, type HubOrder, type MenuSnapshot, type OnlineSettings, type OutletConfig, type Serviceability } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { getMenu } from '../queries/menu.js';

/** A dish with sizes is published once per size: "<itemId>:<variantId>" (product owner, 2026-11-03). */
export const onlineItemId = (itemId: string, variantId: string | null) => (variantId ? `${itemId}:${variantId}` : itemId);
export function parseOnlineItemId(id: string): { itemId: string; variantId: string | null } {
  const [itemId, variantId] = id.split(':');
  return { itemId: itemId!, variantId: variantId ?? null };
}

export interface PublishedMenuBody {
  storeName: string;
  categories: Array<{ id: string; name: string; sort: number }>;
  items: Array<{
    id: string;
    categoryId: string | null;
    name: string;
    price: number;
    unit: string;
    isVeg: boolean;
    rateBp: number;
    cessBp: number;
    priceIncludesTax: boolean;
    modifierGroupIds: string[];
    available: boolean;
    channels: Array<'app' | 'website' | 'swiggy' | 'zomato'>;
    /** The dish's photo ("<sha256>.webp"), served by the hub once the connector uploaded it. */
    image: string | null;
  }>;
  modifierGroups: Array<{ id: string; name: string; minSelect: number; maxSelect: number; modifiers: Array<{ id: string; name: string; price: number }> }>;
  roundToRupee: boolean;
  feeTax: { rateBp: number; cessBp: number; priceIncludesTax: boolean } | null;
  options: {
    acceptMode: 'manual' | 'auto';
    acceptTimeoutMin: number;
    channels: { app: boolean; website: boolean; swiggy: boolean; zomato: boolean };
    fulfilment: { pickup: boolean; delivery: boolean };
    payments: { online: boolean; cod: boolean };
  };
  serviceability: Omit<Serviceability, 'hours'> & { hours: Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', Array<{ open: string; close: string }>> };
}

/** The base menu (no area price list: online orders have no table) as the hub wants it, and its hash. */
export function publishedMenu(db: Db, settings: OnlineSettings, cfg: OutletConfig): { body: PublishedMenuBody; hash: string } {
  const menu = getMenu(db) as MenuSnapshot;
  // every dish is sold on every channel switched on (Swiggy / Zomato too, P6-06: the hub sends this menu to UrbanPiper,
  // so platform orders come back with these ids)
  const channels = (['app', 'website', 'swiggy', 'zomato'] as const).filter((c) => settings.channels[c]);
  const items: PublishedMenuBody['items'] = [];
  for (const i of menu.items) {
    const base = { categoryId: i.categoryId, unit: 'nos', isVeg: i.veg, rateBp: i.taxRateBp, cessBp: 0, priceIncludesTax: false, modifierGroupIds: i.addonGroupIds, available: i.available, channels: [...channels], image: i.image ?? null };
    if (i.variants.length === 0) items.push({ ...base, id: i.id, name: i.name, price: i.pricePaise });
    else for (const v of i.variants) items.push({ ...base, id: onlineItemId(i.id, v.id), name: `${i.name} (${v.name})`, price: v.pricePaise });
  }
  const body: PublishedMenuBody = {
    storeName: cfg['outlet.name'],
    categories: menu.categories.map((c, i) => ({ id: c.id, name: c.name, sort: i })),
    items,
    modifierGroups: menu.addonGroups.map((g) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, modifiers: g.addons.map((a) => ({ id: a.id, name: a.name, price: a.pricePaise })) })),
    roundToRupee: cfg['bill.roundOffStep'] === 100,
    feeTax: settings.feeTaxBp === null ? null : { rateBp: settings.feeTaxBp, cessBp: 0, priceIncludesTax: false },
    options: {
      acceptMode: settings.acceptMode,
      acceptTimeoutMin: settings.acceptTimeoutMin,
      channels: { app: settings.channels.app, website: settings.channels.website, swiggy: settings.channels.swiggy, zomato: settings.channels.zomato },
      fulfilment: settings.fulfilment,
      payments: settings.payments,
    },
    serviceability: { ...settings.serviceability, hours: Object.fromEntries(Object.entries(settings.serviceability.hours).map(([d, s]) => [d, s])) as PublishedMenuBody['serviceability']['hours'] },
  };
  return { body, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}

/**
 * Delivery and packaging charges for an order. Website / app: from this store's own settings (contract `quote`, by the
 * hub's distance). Swiggy / Zomato (P6-06): the platform's own charges as the hub sent them; there is no distance (the
 * platform's rider delivers, or it already checked the address), so no band is looked up.
 */
export function feesFor(order: Pick<HubOrder, 'channel' | 'fulfilment' | 'distanceKm' | 'deliveryFee' | 'packagingFee'>, itemsTotal: number, s: Serviceability): { deliveryFee: number; packagingFee: number; problem: string | null } {
  if (isPlatformOrder(order)) return { deliveryFee: order.deliveryFee, packagingFee: order.packagingFee, problem: null };
  if (order.fulfilment === 'PICKUP') return { deliveryFee: 0, packagingFee: s.packagingFee, problem: null };
  const km = order.distanceKm;
  const zone = km === null ? undefined : s.zones.find((z) => km <= z.upToKm);
  if (!zone) return { deliveryFee: 0, packagingFee: s.packagingFee, problem: 'The delivery address is outside the delivery area now.' };
  const free = zone.freeDeliveryAbove !== null && itemsTotal >= zone.freeDeliveryAbove;
  return { deliveryFee: free ? 0 : zone.deliveryFee, packagingFee: s.packagingFee, problem: null };
}

export interface PricedLine {
  itemId: string;
  variantId: string | null;
  name: string;
  qty: number;
  unitPricePaise: number;
  taxRateBp: number;
  addons: Array<{ addonId: string; name: string; qty: number; pricePaise: number }>;
  note: string | null;
}

/**
 * The order priced from DinePOS's own menu (the bill is the legal record; the hub's total is what the customer was
 * shown). Fee lines carry the outlet's fee GST. `differs` = the DinePOS total is not the customer's.
 */
export function priceOnlineOrder(db: Db, order: HubOrder, settings: OnlineSettings, cfg: OutletConfig): { lines: PricedLine[]; fees: Array<{ kind: 'delivery' | 'packaging'; name: string; pricePaise: number; taxRateBp: number }>; totalPaise: number; differs: boolean; problem: string | null } {
  const menu = getMenu(db) as MenuSnapshot;
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const addonById = new Map(menu.addonGroups.flatMap((g) => g.addons).map((a) => [a.id, a]));
  const lines: PricedLine[] = [];
  for (const l of order.lines) {
    const { itemId, variantId } = parseOnlineItemId(l.itemId);
    const item = byId.get(itemId);
    const variant = variantId ? item?.variants.find((v) => v.id === variantId) : undefined;
    if (!item || (variantId && !variant)) throw new PosError('INVALID_STATE', `${l.name} is no longer on the menu. Reject the order, or ask the guest.`, { itemId: l.itemId });
    if (l.qtyMilli % 1000 !== 0) throw new PosError('INVALID_STATE', `${l.name}: part quantities are not sold here.`, { itemId: l.itemId });
    const addons = l.modifiers.map((m) => {
      const a = addonById.get(m.id);
      if (!a) throw new PosError('INVALID_STATE', `The option ${m.name} for ${l.name} is no longer on the menu.`, { addonId: m.id });
      return { addonId: a.id, name: a.name, qty: 1, pricePaise: a.pricePaise };
    });
    lines.push({ itemId, variantId, name: variant ? `${item.name} (${variant.name})` : item.name, qty: l.qtyMilli / 1000, unitPricePaise: variant?.pricePaise ?? item.pricePaise, taxRateBp: item.taxRateBp, addons, note: l.note });
  }
  const itemsCalc = calculateBill(
    lines.map((l, i) => ({ id: String(i), qty: l.qty, unitPricePaise: l.unitPricePaise, taxRateBp: l.taxRateBp, addons: l.addons })),
    { pricingMode: 'exclusive', roundOffStep: 0 },
  );
  const { deliveryFee, packagingFee, problem } = feesFor(order, itemsCalc.total, settings.serviceability);
  const fees: Array<{ kind: 'delivery' | 'packaging'; name: string; pricePaise: number; taxRateBp: number }> = [];
  if ((deliveryFee > 0 || packagingFee > 0) && settings.feeTaxBp === null) throw new PosError('INVALID_STATE', 'Set the GST rate for delivery and packaging charges in Settings › Online orders first.');
  if (deliveryFee > 0) fees.push({ kind: 'delivery', name: 'Delivery charge', pricePaise: deliveryFee, taxRateBp: settings.feeTaxBp! });
  if (packagingFee > 0) fees.push({ kind: 'packaging', name: 'Packaging charge', pricePaise: packagingFee, taxRateBp: settings.feeTaxBp! });
  const all = calculateBill(
    [
      ...lines.map((l, i) => ({ id: String(i), qty: l.qty, unitPricePaise: l.unitPricePaise, taxRateBp: l.taxRateBp, addons: l.addons })),
      ...fees.map((f) => ({ id: f.kind, qty: 1, unitPricePaise: f.pricePaise, taxRateBp: f.taxRateBp, addons: [] })),
    ],
    { pricingMode: 'exclusive', roundOffStep: cfg['bill.roundOffStep'], roundOffTie: cfg['bill.roundOffTie'] },
  );
  return { lines, fees, totalPaise: all.total, differs: all.total !== order.total, problem };
}

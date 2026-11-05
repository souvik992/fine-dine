// Table QR: the pure rules (tested), used by the add-on's server code and its screens.
import type { MenuSnapshot } from '@dinepos/shared';

export type AcceptMode = 'staff' | 'auto';

export interface QrSettings {
  enabled: boolean;
  /** staff: a captain or cashier accepts each guest order first; auto: it goes to the kitchen at once. */
  acceptMode: AcceptMode;
  /** Guests may pay a printed bill by UPI (the cashier confirms the money arrived). */
  payOnline: boolean;
  /** Address printed in the QR codes for guests on the outlet's Wi-Fi (empty: the server's first network address). */
  baseUrl: string;
  welcome: string;
}

export const DEFAULT_SETTINGS: QrSettings = { enabled: false, acceptMode: 'staff', payOnline: false, baseUrl: '', welcome: '' };

export type RequestKind = 'order' | 'waiter' | 'pay';
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'done';

/** One line as the guest picks it. */
export interface GuestLine {
  itemId: string;
  variantId?: string | null;
  addonIds?: string[];
  qty: number;
  note?: string | null;
}

/** A checked line, ready for AddItems (prices always from the menu, never from the phone). */
export interface CheckedLine {
  itemId: string;
  variantId: string | null;
  addons: Array<{ addonId: string; qty: number }>;
  qty: number;
  note: string | null;
  /** For the screens: "Paneer Tikka (Large) + Extra cheese". */
  label: string;
  /** Before tax: (unit + add-ons) × qty. */
  amountPaise: number;
}

export const MAX_LINES = 30;
export const MAX_QTY = 20;

/** Checks a guest's order against the current menu; throws an Error with a guest-friendly message. */
export function checkOrder(menu: MenuSnapshot, lines: readonly GuestLine[]): CheckedLine[] {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Your order is empty.');
  if (lines.length > MAX_LINES) throw new Error(`Please order at most ${MAX_LINES} different dishes at a time.`);
  const items = new Map(menu.items.map((i) => [i.id, i]));
  const groups = new Map(menu.addonGroups.map((g) => [g.id, g]));
  return lines.map((l: GuestLine) => {
    const item = typeof l?.itemId === 'string' ? items.get(l.itemId) : undefined;
    if (!item) throw new Error('A dish in your order is no longer on the menu. Please refresh the menu.');
    if (!item.available) throw new Error(`${item.name} is not available right now.`);
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY) throw new Error(`Choose 1 to ${MAX_QTY} of ${item.name}.`);
    let unit = item.pricePaise;
    let variantName = '';
    let variantId: string | null = null;
    if (item.variants.length) {
      const v = item.variants.find((x) => x.id === l.variantId);
      if (!v) throw new Error(`Choose a size for ${item.name}.`);
      unit = v.pricePaise;
      variantName = v.name;
      variantId = v.id;
    } else if (l.variantId) throw new Error(`${item.name} has no sizes.`);
    const addonIds = [...new Set(l.addonIds ?? [])];
    const chosen: Array<{ addonId: string; qty: number; name: string; pricePaise: number }> = [];
    for (const gid of item.addonGroupIds) {
      const g = groups.get(gid);
      if (!g) continue;
      const picked = g.addons.filter((a) => addonIds.includes(a.id));
      if (picked.length < g.minSelect) throw new Error(`Choose ${g.minSelect === 1 ? 'one' : `at least ${g.minSelect}`} ${g.name.toLowerCase()} for ${item.name}.`);
      if (g.maxSelect > 0 && picked.length > g.maxSelect) throw new Error(`Choose at most ${g.maxSelect} ${g.name.toLowerCase()} for ${item.name}.`);
      chosen.push(...picked.map((a) => ({ addonId: a.id, qty: 1, name: a.name, pricePaise: a.pricePaise })));
    }
    if (chosen.length !== addonIds.length) throw new Error(`An extra chosen for ${item.name} is not offered with it.`);
    const note = typeof l.note === 'string' && l.note.trim() ? l.note.trim().slice(0, 100) : null;
    const each = unit + chosen.reduce((s, a) => s + a.pricePaise, 0);
    return {
      itemId: item.id,
      variantId,
      addons: chosen.map(({ addonId, qty }) => ({ addonId, qty })),
      qty: l.qty,
      note,
      label: `${item.name}${variantName ? ` (${variantName})` : ''}${chosen.length ? ` + ${chosen.map((a) => a.name).join(', ')}` : ''}`,
      amountPaise: each * l.qty,
    };
  });
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID-shaped id that is always the same for the same seed (from a SHA-256 hex digest): the steps of accepting one
 * request (open table, add, fire, mark accepted) keep their command ids, so a retry never sends food twice.
 */
export function stableId(hexDigest: string): string {
  let out = CROCKFORD[parseInt(hexDigest.slice(0, 2), 16) % 8]!; // a valid ULID starts with 0-7
  for (let i = 1; i < 26; i++) out += CROCKFORD[parseInt(hexDigest.slice(i * 2, i * 2 + 2), 16) % 32]!;
  return out;
}

/** "1240.50" from paise, without floating point. */
export function rupees(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** "₹1,240.50". */
export function formatRupees(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `₹${r.toLocaleString('en-IN')}${p ? `.${String(p).padStart(2, '0')}` : ''}`;
}

/** The UPI payment link the guest's UPI app opens (NPCI deep link): payee, exact amount, a note naming the bill. */
export function upiLink(vpa: string, payee: string, paise: number, note: string): string {
  const q = new URLSearchParams({ pa: vpa, pn: payee, am: rupees(paise), cu: 'INR', tn: note.slice(0, 50) });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

/** The guest page address for one table. */
export function guestUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/a/tableqr/?t=${encodeURIComponent(token)}`;
}

/** The marks on a floor tile from the table's pending requests. */
export function badgesFor(pending: ReadonlyArray<{ kind: RequestKind; amountPaise: number | null }>): Array<{ key: string; label: string; tone: 'info' | 'warn' | 'alert' }> {
  const out: Array<{ key: string; label: string; tone: 'info' | 'warn' | 'alert' }> = [];
  const orders = pending.filter((p) => p.kind === 'order').length;
  if (orders) out.push({ key: 'order', label: orders > 1 ? `QR orders ${orders}` : 'QR order', tone: 'alert' });
  if (pending.some((p) => p.kind === 'waiter')) out.push({ key: 'waiter', label: 'Waiter called', tone: 'alert' });
  const pay = pending.find((p) => p.kind === 'pay');
  if (pay) out.push({ key: 'pay', label: `Paid? ${formatRupees(pay.amountPaise ?? 0)}`, tone: 'warn' });
  return out;
}

/** Settings stored as key/value text rows → typed settings (unknown keys ignored, bad values fall back). */
export function readSettings(rows: ReadonlyArray<{ key: string; value: string }>): QrSettings {
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    enabled: m.get('enabled') === '1',
    acceptMode: m.get('acceptMode') === 'auto' ? 'auto' : 'staff',
    payOnline: m.get('payOnline') === '1',
    baseUrl: m.get('baseUrl') ?? '',
    welcome: m.get('welcome') ?? '',
  };
}

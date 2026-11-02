// Pure billing-screen logic (no React): quick entry, search, modifier sheet options and checks.
import { lineAmount, type MenuAddonGroup, type MenuItem, type MenuSnapshot, type OrderItemSnapshot } from '@dinepos/shared';

export interface QuickEntry {
  item: MenuItem;
  qty: number;
}

const MAX_QTY = 999;

/**
 * Resolves what the biller typed into an item and quantity (docs/09: `pt2` = Paneer Tikka × 2).
 * Accepts `pt`, `pt2`, `pt 2`, `pt*2`, `2*pt`, `2 pt`. An exact short code wins first, so codes ending in
 * digits (e.g. `C65`) still work. Returns null when nothing matches.
 */
export function resolveQuickEntry(menu: MenuSnapshot, input: string): QuickEntry | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const byCode = new Map(menu.items.filter((i) => i.shortCode).map((i) => [i.shortCode!.toLowerCase(), i]));
  const hit = (code: string, qty: number): QuickEntry | null => {
    const item = byCode.get(code);
    return item && qty >= 1 && qty <= MAX_QTY ? { item, qty } : null;
  };

  // Every reading of the input, most specific first; the first that names a real item wins.
  const compact = raw.replace(/\s+/g, '');
  const candidates: Array<[string, number]> = [[compact, 1]];
  let m = /^(\S+)\s+(\d{1,3})$/.exec(raw); // "c65 2"
  if (m) candidates.push([m[1]!, Number(m[2])]);
  m = /^([a-z0-9]*[a-z])\*?(\d{1,3})$/.exec(compact); // pt2, pt*2
  if (m) candidates.push([m[1]!, Number(m[2])]);
  m = /^(\d{1,3})\*?([a-z][a-z0-9]*)$/.exec(compact); // 2pt, 2*pt
  if (m) candidates.push([m[2]!, Number(m[1])]);
  for (const [code, qty] of candidates) {
    const found = hit(code, qty);
    if (found) return found;
  }
  return null;
}

/** Items to show: a search across the whole menu (code prefix, or every typed word starting a word of the name), else the chosen category. */
export function visibleItems(menu: MenuSnapshot, categoryId: string | null, query: string): MenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return categoryId ? menu.items.filter((i) => i.categoryId === categoryId) : menu.items;
  const words = q.replace(/[*\d]+$/, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const code = words.join('');
  return menu.items
    .filter((i) => {
      if (i.shortCode?.toLowerCase().startsWith(code)) return true;
      const nameWords = i.name.toLowerCase().split(/[^a-z0-9]+/);
      return words.every((w) => nameWords.some((n) => n.startsWith(w)));
    })
    .sort((a, b) => Number(b.shortCode?.toLowerCase() === code) - Number(a.shortCode?.toLowerCase() === code));
}

export function groupsOf(menu: MenuSnapshot, item: MenuItem): MenuAddonGroup[] {
  const byId = new Map(menu.addonGroups.map((g) => [g.id, g]));
  return item.addonGroupIds.map((id) => byId.get(id)).filter((g): g is MenuAddonGroup => g !== undefined);
}

/** The sheet must open when the item cannot be added without a choice (a variant, or a required addon). */
export function needsChoices(menu: MenuSnapshot, item: MenuItem): boolean {
  return item.variants.length > 0 || groupsOf(menu, item).some((g) => g.minSelect > 0);
}

/** True when the item has anything to choose at all (Shift+Enter / click opens the sheet). */
export function hasChoices(menu: MenuSnapshot, item: MenuItem): boolean {
  return item.variants.length > 0 || groupsOf(menu, item).length > 0;
}

export interface SheetOption {
  /** "1".."9", "0" for the first ten options, then none (mouse only). */
  hotkey?: string;
  kind: 'variant' | 'addon';
  groupId: string | null;
  id: string;
  name: string;
  pricePaise: number;
  single: boolean;
}

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Every option in sheet order, numbered for the keyboard. */
export function sheetOptions(menu: MenuSnapshot, item: MenuItem): SheetOption[] {
  const out: SheetOption[] = [
    ...item.variants.map((v) => ({ kind: 'variant' as const, groupId: null, id: v.id, name: v.name, pricePaise: v.pricePaise, single: true })),
    ...groupsOf(menu, item).flatMap((g) =>
      g.addons.map((a) => ({ kind: 'addon' as const, groupId: g.id, id: a.id, name: a.name, pricePaise: a.pricePaise, single: g.maxSelect === 1 })),
    ),
  ];
  return out.map((o, i) => (i < HOTKEYS.length ? { ...o, hotkey: HOTKEYS[i] } : o));
}

export interface Selection {
  variantId: string | null;
  addonIds: string[];
}

/** Toggles an option: single-choice groups (and variants) replace, multi-choice groups add/remove. */
export function toggle(menu: MenuSnapshot, item: MenuItem, sel: Selection, opt: SheetOption): Selection {
  if (opt.kind === 'variant') return { ...sel, variantId: sel.variantId === opt.id ? null : opt.id };
  const has = sel.addonIds.includes(opt.id);
  if (has) return { ...sel, addonIds: sel.addonIds.filter((a) => a !== opt.id) };
  const group = groupsOf(menu, item).find((g) => g.id === opt.groupId);
  const siblings = new Set(group?.addons.map((a) => a.id) ?? []);
  const kept = opt.single ? sel.addonIds.filter((a) => !siblings.has(a)) : sel.addonIds;
  const inGroup = kept.filter((a) => siblings.has(a)).length;
  if (group && !opt.single && inGroup >= group.maxSelect) return sel; // full: ignore
  return { ...sel, addonIds: [...kept, opt.id] };
}

/** What still blocks "Add": a missing variant or a group outside its min/max. */
export function selectionProblems(menu: MenuSnapshot, item: MenuItem, sel: Selection): string[] {
  const problems: string[] = [];
  if (item.variants.length > 0 && !sel.variantId) problems.push('Choose an option');
  for (const g of groupsOf(menu, item)) {
    const n = g.addons.filter((a) => sel.addonIds.includes(a.id)).length;
    if (n < g.minSelect) problems.push(g.minSelect === g.maxSelect ? `${g.name}: choose ${g.minSelect}` : `${g.name}: choose at least ${g.minSelect}`);
  }
  return problems;
}

/** Display amount of a cart line (shared helper, integer paise; totals always come from the server). */
export function cartLineAmount(i: OrderItemSnapshot): number {
  return lineAmount({ id: i.id, qty: i.qty, unitPricePaise: i.unitPricePaise, taxRateBp: i.taxRateBp, addons: i.addons });
}

export interface KotGroup {
  kotNo: number;
  /** For "Reprint KOT". */
  kotId: string | undefined;
  items: OrderItemSnapshot[];
}

/**
 * Sent lines grouped by KOT number (newest first), as the cart shows them. Cancelled lines stay in their KOT
 * (shown struck through) so the table can see what was sent and taken back.
 */
export function firedByKot(items: readonly OrderItemSnapshot[]): KotGroup[] {
  const groups = new Map<number, OrderItemSnapshot[]>();
  for (const i of items) {
    if ((i.status === 'fired' || i.status === 'cancelled') && i.kotNo !== undefined) groups.set(i.kotNo, [...(groups.get(i.kotNo) ?? []), i]);
  }
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([kotNo, list]) => ({ kotNo, kotId: list[0]!.kotId, items: list }));
}

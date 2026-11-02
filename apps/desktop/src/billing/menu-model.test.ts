import type { MenuItem, MenuSnapshot, OrderItemSnapshot } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import {
  cartLineAmount,
  firedByKot,
  hasChoices,
  needsChoices,
  resolveQuickEntry,
  selectionProblems,
  sheetOptions,
  toggle,
  visibleItems,
  type Selection,
} from './menu-model.js';

const item = (id: string, code: string, name: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  categoryId: 'starters',
  name,
  shortCode: code,
  veg: true,
  pricePaise: 10_000,
  taxRateBp: 500,
  available: true,
  sort: 0,
  variants: [],
  addonGroupIds: [],
  ...extra,
});

const menu: MenuSnapshot = {
  menuVersion: 1,
  stations: [],
  categories: [
    { id: 'starters', name: 'Starters', sort: 0 },
    { id: 'breads', name: 'Breads', sort: 1 },
  ],
  addonGroups: [
    { id: 'spice', name: 'Spice level', minSelect: 1, maxSelect: 1, addons: [{ id: 'mild', name: 'Mild', pricePaise: 0 }, { id: 'hot', name: 'Hot', pricePaise: 0 }] },
    { id: 'extras', name: 'Extras', minSelect: 0, maxSelect: 2, addons: [{ id: 'cheese', name: 'Cheese', pricePaise: 4_000 }, { id: 'butter', name: 'Butter', pricePaise: 3_000 }, { id: 'paneer', name: 'Paneer', pricePaise: 6_000 }] },
  ],
  items: [
    item('pt', 'PT', 'Paneer Tikka', { addonGroupIds: ['spice'] }),
    item('tc', 'TC', 'Tandoori Chicken', { veg: false, variants: [{ id: 'half', name: 'Half', pricePaise: 32_000, sort: 0 }, { id: 'full', name: 'Full', pricePaise: 58_000, sort: 1 }] }),
    item('bn', 'BN', 'Butter Naan', { categoryId: 'breads', addonGroupIds: ['extras'] }),
    item('c65', 'C65', 'Chicken 65'),
    item('dm', 'DM', 'Dal Makhani'),
  ],
};
const byId = (id: string) => menu.items.find((i) => i.id === id)!;

describe('resolveQuickEntry', () => {
  it('reads code + quantity in the forms billers type', () => {
    expect(resolveQuickEntry(menu, 'pt')).toMatchObject({ item: { id: 'pt' }, qty: 1 });
    for (const s of ['pt2', 'PT 2', 'pt*2', '2*pt', '2pt', ' pt2 ']) expect(resolveQuickEntry(menu, s)).toMatchObject({ item: { id: 'pt' }, qty: 2 });
  });

  it('matches a code ending in digits exactly before splitting off a quantity', () => {
    expect(resolveQuickEntry(menu, 'c65')).toMatchObject({ item: { id: 'c65' }, qty: 1 });
    expect(resolveQuickEntry(menu, 'c65 3')).toMatchObject({ item: { id: 'c65' }, qty: 3 });
  });

  it('returns null for unknown codes and silly quantities', () => {
    expect(resolveQuickEntry(menu, 'zz')).toBeNull();
    expect(resolveQuickEntry(menu, 'pt0')).toBeNull();
    expect(resolveQuickEntry(menu, 'pt9999')).toBeNull();
    expect(resolveQuickEntry(menu, '')).toBeNull();
  });
});

describe('visibleItems', () => {
  it('shows the chosen category without a query', () => {
    expect(visibleItems(menu, 'breads', '').map((i) => i.id)).toEqual(['bn']);
  });

  it('searches the whole menu by code prefix or name words, exact code first', () => {
    expect(visibleItems(menu, 'breads', 'pt2').map((i) => i.id)).toEqual(['pt']);
    expect(visibleItems(menu, null, 'chick').map((i) => i.id)).toEqual(['tc', 'c65']);
    expect(visibleItems(menu, null, 'tandoori chicken').map((i) => i.id)).toEqual(['tc']);
    expect(visibleItems(menu, null, 'd').map((i) => i.id)).toEqual(['dm']);
  });
});

describe('modifier sheet', () => {
  it('opens only when a choice is required', () => {
    expect(needsChoices(menu, byId('pt'))).toBe(true); // required spice
    expect(needsChoices(menu, byId('tc'))).toBe(true); // variants
    expect(needsChoices(menu, byId('bn'))).toBe(false); // optional extras
    expect(hasChoices(menu, byId('bn'))).toBe(true);
    expect(hasChoices(menu, byId('dm'))).toBe(false);
  });

  it('numbers options 1..n for the keyboard', () => {
    expect(sheetOptions(menu, byId('tc')).map((o) => `${o.hotkey}:${o.name}`)).toEqual(['1:Half', '2:Full']);
    expect(sheetOptions(menu, byId('bn')).map((o) => o.hotkey)).toEqual(['1', '2', '3']);
  });

  it('single-choice replaces, multi-choice respects the group max', () => {
    const pt = byId('pt');
    const [mild, hot] = sheetOptions(menu, pt);
    let sel: Selection = { variantId: null, addonIds: [] };
    sel = toggle(menu, pt, sel, mild!);
    sel = toggle(menu, pt, sel, hot!);
    expect(sel.addonIds).toEqual(['hot']);

    const bn = byId('bn');
    const [cheese, butter, paneer] = sheetOptions(menu, bn);
    let s2: Selection = { variantId: null, addonIds: [] };
    for (const o of [cheese!, butter!, paneer!]) s2 = toggle(menu, bn, s2, o);
    expect(s2.addonIds).toEqual(['cheese', 'butter']); // max 2
    s2 = toggle(menu, bn, s2, cheese!);
    expect(s2.addonIds).toEqual(['butter']);
  });

  it('reports what blocks Add', () => {
    expect(selectionProblems(menu, byId('pt'), { variantId: null, addonIds: [] })).toEqual(['Spice level: choose 1']);
    expect(selectionProblems(menu, byId('tc'), { variantId: null, addonIds: [] })).toEqual(['Choose an option']);
    expect(selectionProblems(menu, byId('tc'), { variantId: 'half', addonIds: [] })).toEqual([]);
  });
});

describe('cart helpers', () => {
  const line = (id: string, status: OrderItemSnapshot['status'], kotNo?: number): OrderItemSnapshot => ({
    id,
    itemId: 'x',
    name: id,
    qty: 2,
    unitPricePaise: 6_000,
    taxRateBp: 500,
    addons: [{ addonId: 'cheese', name: 'Cheese', qty: 1, pricePaise: 4_000 }],
    course: 1,
    status,
    kotNo,
  });

  it('line amount is qty × price + addons, in paise', () => {
    expect(cartLineAmount(line('a', 'held'))).toBe(16_000);
  });

  it('groups fired lines by KOT, newest first', () => {
    const groups = firedByKot([line('a', 'fired', 1), line('b', 'held'), line('c', 'fired', 2), line('d', 'fired', 1)]);
    expect(groups.map((g) => [g.kotNo, g.items.map((i) => i.id)])).toEqual([
      [2, ['c']],
      [1, ['a', 'd']],
    ]);
  });
});

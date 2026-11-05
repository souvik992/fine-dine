import type { MenuSnapshot } from '@dinepos/shared';
import { ULID_RE } from '@dinepos/shared';
import { describe, expect, it } from 'vitest';
import { badgesFor, checkOrder, formatRupees, guestUrl, readSettings, rupees, stableId, upiLink } from './logic.js';

const menu: MenuSnapshot = {
  menuVersion: 1,
  stations: [],
  categories: [{ id: 'c1', name: 'Mains', sort: 1 }],
  addonGroups: [
    { id: 'g1', name: 'Extras', minSelect: 0, maxSelect: 2, addons: [{ id: 'a1', name: 'Cheese', pricePaise: 3000 }, { id: 'a2', name: 'Olives', pricePaise: 2000 }, { id: 'a3', name: 'Egg', pricePaise: 1500 }] },
    { id: 'g2', name: 'Spice', minSelect: 1, maxSelect: 1, addons: [{ id: 's1', name: 'Mild', pricePaise: 0 }, { id: 's2', name: 'Hot', pricePaise: 0 }] },
  ],
  items: [
    { id: 'i1', categoryId: 'c1', name: 'Pizza', veg: true, pricePaise: 0, taxRateBp: 500, available: true, sort: 1, variants: [{ id: 'v1', name: 'Small', pricePaise: 25000, sort: 1 }, { id: 'v2', name: 'Large', pricePaise: 40000, sort: 2 }], addonGroupIds: ['g1'] },
    { id: 'i2', categoryId: 'c1', name: 'Curry', veg: false, pricePaise: 32000, taxRateBp: 500, available: true, sort: 2, variants: [], addonGroupIds: ['g2'] },
    { id: 'i3', categoryId: 'c1', name: 'Soup', veg: true, pricePaise: 15000, taxRateBp: 500, available: false, sort: 3, variants: [], addonGroupIds: [] },
  ],
};

describe('Table QR rules', () => {
  it('a guest order is priced from the menu, with sizes and extras', () => {
    const lines = checkOrder(menu, [
      { itemId: 'i1', variantId: 'v2', addonIds: ['a1'], qty: 2, note: '  no onion ' },
      { itemId: 'i2', addonIds: ['s2'], qty: 1 },
    ]);
    expect(lines).toEqual([
      { itemId: 'i1', variantId: 'v2', addons: [{ addonId: 'a1', qty: 1 }], qty: 2, note: 'no onion', label: 'Pizza (Large) + Cheese', amountPaise: 86000 },
      { itemId: 'i2', variantId: null, addons: [{ addonId: 's2', qty: 1 }], qty: 1, note: null, label: 'Curry + Hot', amountPaise: 32000 },
    ]);
  });

  it.each([
    [[], /empty/],
    [[{ itemId: 'nope', qty: 1 }], /no longer on the menu/],
    [[{ itemId: 'i3', qty: 1 }], /Soup is not available/],
    [[{ itemId: 'i1', qty: 1 }], /Choose a size for Pizza/],
    [[{ itemId: 'i2', variantId: 'v1', qty: 1, addonIds: ['s1'] }], /has no sizes/],
    [[{ itemId: 'i2', qty: 1 }], /Choose one spice for Curry/],
    [[{ itemId: 'i1', variantId: 'v1', qty: 1, addonIds: ['a1', 'a2', 'a3'] }], /at most 2 extras/],
    [[{ itemId: 'i1', variantId: 'v1', qty: 1, addonIds: ['s1'] }], /not offered with it/],
    [[{ itemId: 'i2', qty: 0, addonIds: ['s1'] }], /Choose 1 to 20/],
    [[{ itemId: 'i2', qty: 2.5, addonIds: ['s1'] }], /Choose 1 to 20/],
  ])('refuses %j', (lines, message) => {
    expect(() => checkOrder(menu, lines as never)).toThrow(message);
  });

  it('stable ids are valid ULIDs and the same for the same seed', () => {
    const a = stableId('a'.repeat(64));
    expect(a).toMatch(ULID_RE);
    expect(stableId('a'.repeat(64))).toBe(a);
    expect(stableId('ff'.repeat(32))).toMatch(ULID_RE);
    expect(stableId('b'.repeat(64))).not.toBe(a);
  });

  it('money as rupees without floating point; the UPI link carries the exact amount', () => {
    expect(rupees(124050)).toBe('1240.50');
    expect(rupees(5)).toBe('0.05');
    expect(formatRupees(124000)).toBe('₹1,240');
    expect(formatRupees(124005)).toBe('₹1,240.05');
    expect(upiLink('cafe@okbank', 'Spice Garden', 124050, 'Bill 000123 table T4')).toBe('upi://pay?pa=cafe%40okbank&pn=Spice%20Garden&am=1240.50&cu=INR&tn=Bill%20000123%20table%20T4');
    expect(guestUrl('http://192.168.1.20:7420/', 'tok en')).toBe('http://192.168.1.20:7420/a/tableqr/?t=tok%20en');
  });

  it('tile marks: orders (alert), waiter (alert), a payment to check (warn)', () => {
    expect(badgesFor([])).toEqual([]);
    expect(badgesFor([{ kind: 'order', amountPaise: null }, { kind: 'order', amountPaise: null }, { kind: 'waiter', amountPaise: null }, { kind: 'pay', amountPaise: 124000 }])).toEqual([
      { key: 'order', label: 'QR orders 2', tone: 'alert' },
      { key: 'waiter', label: 'Waiter called', tone: 'alert' },
      { key: 'pay', label: 'Paid? ₹1,240', tone: 'warn' },
    ]);
  });

  it('settings fall back to safe values', () => {
    expect(readSettings([])).toEqual({ enabled: false, acceptMode: 'staff', payOnline: false, baseUrl: '', welcome: '' });
    expect(readSettings([{ key: 'enabled', value: '1' }, { key: 'acceptMode', value: 'auto' }, { key: 'acceptMode', value: 'weird' }]).acceptMode).toBe('staff');
  });
});

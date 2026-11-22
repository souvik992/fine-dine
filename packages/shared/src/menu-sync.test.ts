import { describe, expect, it } from 'vitest';
import { channelLists, channelPrice, menuSyncSchema, DEFAULT_MENU_SYNC, type ChannelSync } from './online.js';

// Menu sync per channel (quickPOS ODS). channelPrice is the hub's own rule (posinext-cloud contract/src/menu.ts), so the
// total the customer pays and the DinePOS bill agree to the paisa.
const custom = (over: Partial<ChannelSync> = {}): ChannelSync => ({ mode: 'all', items: [], pricing: 'custom', markupBp: 0, prices: {}, ...over });

describe('channelPrice', () => {
  it('same as the POS: the POS price, untouched', () => {
    expect(channelPrice('dal', 28_050, { pricing: 'same', markupBp: 1500, prices: { dal: 1 } })).toBe(28_050);
    expect(channelPrice('dal', 28_050, custom())).toBe(28_050); // custom with no change keeps paise
  });

  it('a percentage change is rounded to the nearest rupee (half up), up or down', () => {
    expect(channelPrice('dal', 28_000, custom({ markupBp: 1500 }))).toBe(32_200);
    expect(channelPrice('x', 12_345, custom({ markupBp: 1000 }))).toBe(13_600); // 135.795 → ₹136
    expect(channelPrice('x', 10_000, custom({ markupBp: 1250 }))).toBe(11_300); // 112.50 → ₹113
    expect(channelPrice('dal', 28_000, custom({ markupBp: -1000 }))).toBe(25_200);
  });

  it('a price set for the dish (or size) wins over the percentage', () => {
    expect(channelPrice('bc:full', 52_000, custom({ markupBp: 1500, prices: { 'bc:full': 49_900 } }))).toBe(49_900);
    expect(channelPrice('bc:half', 30_000, custom({ markupBp: 1500, prices: { 'bc:full': 49_900 } }))).toBe(34_500);
  });
});

describe('channelLists', () => {
  it('all, all except, only', () => {
    expect(channelLists(custom(), 'dal')).toBe(true);
    expect(channelLists(custom({ mode: 'exclude', items: ['dal'] }), 'dal')).toBe(false);
    expect(channelLists(custom({ mode: 'exclude', items: ['dal'] }), 'naan')).toBe(true);
    expect(channelLists(custom({ mode: 'include', items: ['dal'] }), 'naan')).toBe(false);
  });

  it('the default lists everything at POS prices; a change beyond -50% / +100% is refused', () => {
    expect(menuSyncSchema.parse(DEFAULT_MENU_SYNC)).toEqual(DEFAULT_MENU_SYNC);
    expect(menuSyncSchema.safeParse({ ...DEFAULT_MENU_SYNC, app: custom({ markupBp: 20_000 }) }).success).toBe(false);
    expect(menuSyncSchema.safeParse({ ...DEFAULT_MENU_SYNC, app: custom({ markupBp: -6000 }) }).success).toBe(false);
  });
});

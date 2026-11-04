import { describe, expect, it } from 'vitest';
import { matchPhotos, photoKey } from './menu-photo.js';
import { parseRecipeCsv, RECIPE_CSV_HEADER, recipesToCsv, type RecipeCsvContext } from './recipe-csv.js';

const ctx: RecipeCsvContext = {
  items: [
    { id: 'PT', name: 'Paneer Tikka', variants: [] },
    { id: 'TC', name: 'Tandoori Chicken', variants: [{ id: 'TCH', name: 'Half' }, { id: 'TCF', name: 'Full' }] },
  ],
  addonGroups: [
    { name: 'Extras', addons: [{ id: 'CH', name: 'Cheese' }, { id: 'BT', name: 'Butter' }] },
    { name: 'Dips', addons: [{ id: 'BT2', name: 'Butter' }] },
  ],
  materials: [
    { id: 'M1', name: 'Paneer', unit: 'kg' },
    { id: 'M2', name: 'Onion', unit: 'kg' },
    { id: 'M3', name: 'Chicken', unit: 'kg' },
    { id: 'M4', name: 'Amul Butter', unit: 'kg' },
  ],
};
const csv = (...rows: string[]) => [RECIPE_CSV_HEADER, ...rows].join('\n');

describe('parseRecipeCsv', () => {
  it('groups lines into recipes for dishes, sizes and add-ons, matching names ignoring case and spaces', () => {
    const r = parseRecipeCsv(csv('paneer tikka,,,PANEER,0.15', 'Paneer Tikka,,,Onion,0.05', 'Tandoori Chicken,full,,Chicken,0.5', ',,Cheese,Paneer,0.03', ',,Dips / Butter,Amul Butter,0.01'), ctx);
    expect(r.errors).toEqual([]);
    expect(r.recipes.map((x) => [x.ownerKind, x.ownerId, x.label, x.lines.map((l) => [l.stockItemId, l.qtyMilli])])).toEqual([
      ['item', 'PT', 'Paneer Tikka', [['M1', 150], ['M2', 50]]],
      ['variant', 'TCF', 'Tandoori Chicken (Full)', [['M3', 500]]],
      ['addon', 'CH', 'Add-on: Cheese', [['M1', 30]]],
      ['addon', 'BT2', 'Add-on: Butter', [['M4', 10]]],
    ]);
  });

  it('says what is wrong on which line', () => {
    const r = parseRecipeCsv(
      csv('Pizza,,,Paneer,1', 'Tandoori Chicken,Quarter,,Chicken,1', ',,Butter,Amul Butter,1', 'Paneer Tikka,,,Ghee,1', 'Paneer Tikka,,,Paneer,abc', 'Paneer Tikka,,,Paneer,0.1', 'Paneer Tikka,,,Paneer,0.2', 'Paneer Tikka,,Cheese,Paneer,1', ',,,Paneer,1'),
      ctx,
    );
    expect(r.errors).toEqual([
      { row: 2, message: '"Pizza" is not on the menu.' },
      { row: 3, message: '"Tandoori Chicken" has no size "Quarter" (sizes: Half, Full).' },
      { row: 4, message: '"Butter" is in more than one add-on group (Extras, Dips). Write it as "Group / Add-on".' },
      { row: 5, message: '"Ghee" is not a material. Add it in Stock › Materials first (names must match).' },
      { row: 6, message: 'The quantity "abc" is not a number above 0 (in kg, up to 3 decimals).' },
      { row: 8, message: 'Paneer appears twice for Paneer Tikka. Put the total on one line.' },
      { row: 9, message: 'Fill in either the dish or the add-on, not both.' },
      { row: 10, message: 'Fill in the dish (or the add-on) this ingredient is for.' },
    ]);
  });

  it('needs the header columns', () => {
    expect(parseRecipeCsv('dish,material\nPaneer Tikka,Paneer', ctx).errors[0]!.message).toMatch(/"addon", "quantity" columns are missing/);
    expect(parseRecipeCsv(RECIPE_CSV_HEADER, ctx).errors[0]!.message).toMatch(/no recipe lines/);
  });

  it('the download reads back to the same recipes; with none it is a template from this menu', () => {
    const lines = [
      { ownerKind: 'item' as const, ownerId: 'PT', stockItemId: 'M1', qtyMilli: 150 },
      { ownerKind: 'variant' as const, ownerId: 'TCH', stockItemId: 'M3', qtyMilli: 250 },
      { ownerKind: 'addon' as const, ownerId: 'BT', stockItemId: 'M4', qtyMilli: 10 },
    ];
    const text = recipesToCsv(lines, ctx);
    expect(text.split('\r\n')[0]).toBe(RECIPE_CSV_HEADER);
    expect(text).toContain('Extras / Butter'); // an add-on name used in two groups is written with its group
    const back = parseRecipeCsv(text, ctx);
    expect(back.errors).toEqual([]);
    expect(back.recipes.flatMap((r) => r.lines.map((l) => ({ ownerKind: r.ownerKind, ownerId: r.ownerId, stockItemId: l.stockItemId, qtyMilli: l.qtyMilli })))).toEqual(expect.arrayContaining(lines));
    expect(parseRecipeCsv(recipesToCsv([], ctx), ctx).errors).toEqual([]);
  });
});

describe('matchPhotos', () => {
  const items = [
    { id: 'PT', name: 'Paneer Tikka', shortCode: 'PT' },
    { id: 'DM', name: 'Dal Makhani', shortCode: 'DM' },
    { id: 'V1', name: 'Veg Roll', shortCode: null },
    { id: 'V2', name: 'Veg-Roll', shortCode: null },
  ];
  it('matches by name (any case, spaces or punctuation) or short code; unclear ones are left to choose', () => {
    expect(photoKey('Paneer_Tikka (1).JPG')).toBe('paneer tikka');
    expect(matchPhotos(['paneer-tikka.jpg', 'DM.png', 'paneertikka copy.webp', 'veg roll.jpg', 'pizza.jpg'], items)).toEqual([
      { file: 'paneer-tikka.jpg', itemId: 'PT', how: 'name' },
      { file: 'DM.png', itemId: 'DM', how: 'code' },
      { file: 'paneertikka copy.webp', itemId: null, how: 'duplicate', duplicateOf: 'paneer-tikka.jpg' },
      { file: 'veg roll.jpg', itemId: null, how: 'ambiguous' },
      { file: 'pizza.jpg', itemId: null, how: 'none' },
    ]);
  });
});

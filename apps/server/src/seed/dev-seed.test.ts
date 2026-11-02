import { describe, expect, it } from 'vitest';
import { getFloor } from '../queries/floor.js';
import { getMenu } from '../queries/menu.js';
import { TEST_NOW, useHarness } from '../testing/command-harness.js';
import { DEV_SEED_COUNTS, devSeedCommands, seedId } from './dev-seed.js';

// P1-05 acceptance: seed runs idempotently; floor returns 12 FREE tables.
describe('dev seed', () => {
  const h = useHarness();
  const seed = () => devSeedCommands().map((c) => h.run(c.type, c.payload));
  const counts = () =>
    Object.fromEntries(
      ['area', 'dining_table', 'station', 'printer', 'station_printer', 'category', 'menu_item', 'variant', 'addon_group', 'addon', 'item_addon_group'].map((t) => [
        t,
        h.count(t),
      ]),
    );

  it('creates the demo outlet: 2 areas, 12 tables, 3 stations, 30 items with variants and addons', () => {
    seed();
    expect(counts()).toMatchObject({ area: 2, dining_table: 12, station: 3, menu_item: 30 });
    expect(DEV_SEED_COUNTS).toEqual({ areas: 2, tables: 12, stations: 3, items: 30 });
    expect(h.count('variant')).toBeGreaterThan(0);
    expect(h.count('item_addon_group')).toBeGreaterThan(0);
  });

  it('is idempotent: a second run creates nothing new', () => {
    seed();
    const first = counts();
    const second = seed();
    expect(second.every((r) => (r.result as { created: boolean }).created === false)).toBe(true);
    expect(counts()).toEqual(first);
  });

  it('floor returns 12 FREE tables in area order with natural label order', () => {
    seed();
    const floor = getFloor(h.db, TEST_NOW(), 'Asia/Kolkata');
    expect(floor.tables).toHaveLength(12);
    expect(floor.tables.every((t) => t.state === 'FREE')).toBe(true);
    expect(floor.areas.map((a) => a.name)).toEqual(['Main Hall', 'Terrace']);
    expect(floor.tables.map((t) => t.label)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'R1', 'R2', 'R3', 'R4']);
  });

  it('menu lists all 30 items with integer prices and resolvable references', () => {
    seed();
    const menu = getMenu(h.db);
    if ('unchanged' in menu) throw new Error('expected full menu');
    expect(menu.items).toHaveLength(30);
    const groups = new Set(menu.addonGroups.map((g) => g.id));
    const cats = new Set(menu.categories.map((c) => c.id));
    for (const i of menu.items) {
      expect(Number.isSafeInteger(i.pricePaise)).toBe(true);
      expect(cats.has(i.categoryId)).toBe(true);
      i.addonGroupIds.forEach((g) => expect(groups.has(g)).toBe(true));
    }
    expect(menu.items.find((i) => i.shortCode === 'TC')?.variants.map((v) => v.name)).toEqual(['Half', 'Full']);
  });

  it('seed ids are stable, valid ULIDs', () => {
    expect(seedId('area:main')).toBe(seedId('area:main'));
    expect(seedId('area:main')).not.toBe(seedId('area:terrace'));
    expect(seedId('x')).toMatch(/^01[0-9A-HJKMNP-TV-Z]{24}$/);
  });
});

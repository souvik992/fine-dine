import { newId, type RecipeLineView } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { denyAll, useHarness, type Harness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

// Recipe bulk upload: every recipe in the file or none; the ones named are replaced, the others stay; then KOTs use them.
function material(h: Harness, name: string, unit: 'kg' | 'l' | 'pcs', qtyMilli = 10_000) {
  const id = newId();
  h.run('UpsertStockItem', { id, name, unit, reorderLevelMilli: 0, opening: { qtyMilli, unitCostPaise: 10_000 } });
  return id;
}
const recipe = (h: Harness, kind: string, id: string) =>
  h.db.prepare('SELECT stock_item_id AS stockItemId, qty_milli AS qtyMilli FROM recipe_line WHERE owner_kind = ? AND owner_id = ? ORDER BY stock_item_id').all(kind, id) as Array<Omit<RecipeLineView, 'ownerKind' | 'ownerId'>>;
const onHand = (h: Harness, id: string) => h.db.prepare('SELECT on_hand_milli FROM stock_item WHERE id = ?').pluck().get(id) as number;

describe('ImportRecipes', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let paneer = '';
  let onion = '';
  let butter = '';
  beforeEach(() => {
    seedOutlet(h);
    paneer = material(h, 'Test paneer', 'kg');
    onion = material(h, 'Test onion', 'kg');
    butter = material(h, 'Test butter', 'kg');
  });

  it('replaces the recipes named, leaves the others, audits each; the next KOT takes the new amounts from stock', () => {
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: onion, qtyMilli: 500 }] });
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.dalMakhani, lines: [{ stockItemId: butter, qtyMilli: 20 }] });
    const res = h.run('ImportRecipes', {
      importId: newId(),
      recipes: [
        { ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: paneer, qtyMilli: 150 }, { stockItemId: onion, qtyMilli: 50 }] },
        { ownerKind: 'variant', ownerId: S.tcHalf, lines: [{ stockItemId: butter, qtyMilli: 10 }] },
        { ownerKind: 'addon', ownerId: S.cheese, lines: [{ stockItemId: paneer, qtyMilli: 30 }] },
      ],
    });
    expect(res.result).toEqual({ recipes: 3, changed: 3 });
    expect(recipe(h, 'item', S.paneerTikka)).toEqual([{ stockItemId: paneer, qtyMilli: 150 }, { stockItemId: onion, qtyMilli: 50 }].sort((a, b) => a.stockItemId.localeCompare(b.stockItemId)));
    expect(recipe(h, 'item', S.dalMakhani)).toEqual([{ stockItemId: butter, qtyMilli: 20 }]); // not in the file: kept
    expect(h.count('audit_event', "action = 'recipe.set' AND reason = 'bulk upload'")).toBe(3);

    const id = o.open(S.t1).order!.id;
    o.run('AddItems', id, { items: [line(S.paneerTikka, { qty: 2, addons: [{ addonId: S.mild, qty: 1 }] })] });
    o.run('FireKOT', id, { all: true });
    expect(onHand(h, paneer)).toBe(10_000 - 300);
    expect(onHand(h, onion)).toBe(10_000 - 100);
  });

  it('a recipe already the same is not rewritten (no audit row)', () => {
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: paneer, qtyMilli: 150 }] });
    const res = h.run('ImportRecipes', { importId: newId(), recipes: [{ ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: paneer, qtyMilli: 150 }] }] });
    expect(res.result).toEqual({ recipes: 1, changed: 0 });
    expect(h.count('audit_event', "reason = 'bulk upload'")).toBe(0);
  });

  it('all or nothing: a dish no longer on the menu or a switched-off material refuses the whole file', () => {
    const before = recipe(h, 'item', S.paneerTikka); // the seeded outlet's own recipe
    h.fail('ImportRecipes', {
      importId: newId(),
      recipes: [
        { ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: paneer, qtyMilli: 150 }] },
        { ownerKind: 'item', ownerId: newId(), lines: [{ stockItemId: paneer, qtyMilli: 150 }] },
      ],
    }, 'NOT_FOUND');
    expect(recipe(h, 'item', S.paneerTikka)).toEqual(before);
    h.run('UpsertStockItem', { id: butter, name: 'Test butter', unit: 'kg', active: false });
    h.fail('ImportRecipes', { importId: newId(), recipes: [{ ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: butter, qtyMilli: 10 }] }] }, 'INVALID_STATE');
    h.fail('ImportRecipes', { importId: newId(), recipes: [{ ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: paneer, qtyMilli: 1 }, { stockItemId: paneer, qtyMilli: 2 }] }] }, 'VALIDATION');
  });

  it('needs stock.manage; a replay applies it once', () => {
    const payload = { importId: newId(), recipes: [{ ownerKind: 'item', ownerId: S.paneerTikka, lines: [{ stockItemId: paneer, qtyMilli: 150 }] }] };
    expect(h.fail('ImportRecipes', payload, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'stock.manage' });
    const commandId = newId();
    const first = h.run('ImportRecipes', payload, { commandId });
    expect(h.run('ImportRecipes', payload, { commandId })).toEqual({ ...first, duplicate: true });
    expect(h.count('audit_event', "reason = 'bulk upload'")).toBe(1);
  });
});

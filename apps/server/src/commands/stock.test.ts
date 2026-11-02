import { newId } from '@dinepos/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { listStock, stockUsage } from '../queries/stock.js';
import { denyAll, useHarness, type Harness } from '../testing/command-harness.js';
import { line, orderHelpers, S, seedOutlet } from '../testing/order-fixture.js';

const balance = (h: Harness, id: string) => h.db.prepare('SELECT on_hand_milli FROM stock_item WHERE id = ?').pluck().get(id) as number;
const ledgerSum = (h: Harness, id: string) => h.db.prepare('SELECT coalesce(sum(delta_milli), 0) FROM stock_movement WHERE stock_item_id = ?').pluck().get(id) as number;

function material(h: Harness, name: string, unit: 'kg' | 'g' | 'l' | 'ml' | 'pcs', opening?: { qtyMilli: number; unitCostPaise: number | null }) {
  const id = newId();
  h.run('UpsertStockItem', { id, name, unit, reorderLevelMilli: 0, opening: opening ?? null });
  return id;
}

describe('UpsertStockItem', () => {
  const h = useHarness();

  it('creates with opening stock (one ledger row), then updates name and reorder level only', () => {
    const id = material(h, 'Paneer', 'kg', { qtyMilli: 5000, unitCostPaise: 32_000 });
    expect(balance(h, id)).toBe(5000);
    expect(h.count('stock_movement', `stock_item_id = '${id}' AND kind = 'opening'`)).toBe(1);
    const res = h.run('UpsertStockItem', { id, name: 'Paneer (fresh)', unit: 'kg', reorderLevelMilli: 2000, opening: { qtyMilli: 9000, unitCostPaise: 1 } });
    expect(res.result).toEqual({ id, created: false });
    expect(balance(h, id)).toBe(5000); // opening is only used on create
    const [view] = listStock(h.db);
    expect(view).toMatchObject({ name: 'Paneer (fresh)', reorderLevelMilli: 2000, lastUnitCostPaise: 32_000, valuePaise: 160_000, low: false });
  });

  it('INVALID_STATE when the unit changes, or the name is taken', () => {
    const id = material(h, 'Paneer', 'kg');
    h.fail('UpsertStockItem', { id, name: 'Paneer', unit: 'g' }, 'INVALID_STATE');
    h.fail('UpsertStockItem', { id: newId(), name: 'PANEER', unit: 'kg' }, 'INVALID_STATE');
  });

  it('cannot switch off a material used in a recipe', () => {
    seedOutlet(h);
    const id = material(h, 'Test cream', 'l');
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.dalMakhani, lines: [{ stockItemId: id, qtyMilli: 30 }] });
    h.fail('UpsertStockItem', { id, name: 'Test cream', unit: 'l', active: false }, 'INVALID_STATE');
  });

  it('FORBIDDEN without stock.manage; DUPLICATE replay writes nothing new', () => {
    const p = { id: newId(), name: 'Rice', unit: 'kg', opening: { qtyMilli: 1000, unitCostPaise: 9000 } };
    expect(h.fail('UpsertStockItem', p, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'stock.manage' });
    const commandId = newId();
    h.run('UpsertStockItem', p, { commandId });
    expect(h.run('UpsertStockItem', p, { commandId }).duplicate).toBe(true);
    expect(h.count('stock_movement')).toBe(1);
  });
});

describe('AdjustStock', () => {
  const h = useHarness();
  let rice: string;
  beforeEach(() => {
    rice = material(h, 'Rice', 'kg', { qtyMilli: 10_000, unitCostPaise: 9000 });
  });

  it('wastage removes, count sets the balance, correction adds or removes; every change is audited', () => {
    expect(h.run('AdjustStock', { kind: 'wastage', stockItemId: rice, qtyMilli: 500, reason: 'Spilled' }).result).toMatchObject({ deltaMilli: -500, onHandMilli: 9500 });
    expect(h.run('AdjustStock', { kind: 'count', stockItemId: rice, qtyMilli: 9000 }).result).toMatchObject({ deltaMilli: -500, onHandMilli: 9000 });
    expect(h.run('AdjustStock', { kind: 'adjust', stockItemId: rice, qtyMilli: 250, reason: 'Wrong entry' }).result).toMatchObject({ onHandMilli: 9250 });
    expect(balance(h, rice)).toBe(ledgerSum(h, rice));
    expect(h.count('audit_event', "action IN ('stock.wastage', 'stock.count', 'stock.adjust')")).toBe(3);
    expect(h.db.prepare("SELECT reason FROM stock_movement WHERE kind = 'count'").pluck().get()).toBe('Physical count');
  });

  it('a count equal to the balance writes no movement', () => {
    h.run('AdjustStock', { kind: 'count', stockItemId: rice, qtyMilli: 10_000 });
    expect(h.count('stock_movement')).toBe(1);
  });

  it('VALIDATION without a reason, NOT_FOUND for an unknown material, INVALID_STATE when switched off', () => {
    h.fail('AdjustStock', { kind: 'wastage', stockItemId: rice, qtyMilli: 500 }, 'VALIDATION');
    h.fail('AdjustStock', { kind: 'adjust', stockItemId: rice, qtyMilli: 0, reason: 'x' }, 'VALIDATION');
    h.fail('AdjustStock', { kind: 'wastage', stockItemId: newId(), qtyMilli: 500, reason: 'x' }, 'NOT_FOUND');
    h.run('UpsertStockItem', { id: rice, name: 'Rice', unit: 'kg', active: false });
    h.fail('AdjustStock', { kind: 'wastage', stockItemId: rice, qtyMilli: 500, reason: 'x' }, 'INVALID_STATE');
  });

  it('the ledger is append-only', () => {
    expect(() => h.db.prepare('UPDATE stock_movement SET delta_milli = 0').run()).toThrow(/append-only/);
    expect(() => h.db.prepare('DELETE FROM stock_movement').run()).toThrow(/append-only/);
  });
});

describe('RecordPurchase / VoidPurchase', () => {
  const h = useHarness();
  let paneer: string;
  let oil: string;
  beforeEach(() => {
    paneer = material(h, 'Paneer', 'kg', { qtyMilli: 1000, unitCostPaise: 30_000 });
    oil = material(h, 'Oil', 'l');
  });
  const purchase = (extra: Record<string, unknown> = {}) => ({
    id: newId(),
    supplierName: 'Fresh Dairy',
    invoiceNo: 'FD-101',
    invoiceDate: '2026-11-01',
    lines: [
      { stockItemId: paneer, qtyMilli: 2500, unitCostPaise: 32_050 }, // 2.5 kg × ₹320.50 = ₹801.25
      { stockItemId: oil, qtyMilli: 333, unitCostPaise: 15_000 }, // 0.333 L × ₹150 = ₹49.95
    ],
    ...extra,
  });

  it('adds stock, sets the last cost and totals in integer paise (half up)', () => {
    const p = purchase();
    expect(h.run('RecordPurchase', p).result).toEqual({ purchaseId: p.id, totalPaise: 80_125 + 4995 });
    expect(balance(h, paneer)).toBe(3500);
    expect(h.db.prepare('SELECT last_unit_cost_paise FROM stock_item WHERE id = ?').pluck().get(paneer)).toBe(32_050);
  });

  it('void reverses the stock, keeps the record and resets the cost to the opening cost', () => {
    const p = purchase();
    h.run('RecordPurchase', p);
    h.run('VoidPurchase', { purchaseId: p.id, reason: 'Wrong supplier' });
    expect(balance(h, paneer)).toBe(1000);
    expect(balance(h, oil)).toBe(0);
    expect(h.db.prepare('SELECT status FROM purchase WHERE id = ?').pluck().get(p.id)).toBe('void');
    expect(h.db.prepare('SELECT last_unit_cost_paise FROM stock_item WHERE id = ?').pluck().get(paneer)).toBe(30_000);
    h.fail('VoidPurchase', { purchaseId: p.id, reason: 'again' }, 'INVALID_STATE');
  });

  it('purchases are immutable in the database', () => {
    const p = purchase();
    h.run('RecordPurchase', p);
    expect(() => h.db.prepare('UPDATE purchase SET total_paise = 1').run()).toThrow(/immutable/);
    expect(() => h.db.prepare('DELETE FROM purchase_line').run()).toThrow(/cannot be deleted/);
  });

  it('VALIDATION for a repeated material, a bad GSTIN or a float quantity; INVALID_STATE for the same id twice', () => {
    h.fail('RecordPurchase', purchase({ lines: [{ stockItemId: paneer, qtyMilli: 1, unitCostPaise: 1 }, { stockItemId: paneer, qtyMilli: 1, unitCostPaise: 1 }] }), 'VALIDATION');
    h.fail('RecordPurchase', purchase({ supplierGstin: 'NOT-A-GSTIN' }), 'VALIDATION');
    h.fail('RecordPurchase', purchase({ lines: [{ stockItemId: paneer, qtyMilli: 1.5, unitCostPaise: 1 }] }), 'VALIDATION');
    const p = purchase();
    h.run('RecordPurchase', p);
    h.fail('RecordPurchase', p, 'INVALID_STATE');
  });

  it('FORBIDDEN without stock.manage', () => {
    h.fail('RecordPurchase', purchase(), 'FORBIDDEN', { rights: denyAll });
    expect(h.count('purchase')).toBe(0);
  });
});

describe('recipes and FireKOT', () => {
  const h = useHarness();
  const o = orderHelpers(h);
  let chicken: string;
  let butter: string;
  let flour: string;
  let orderId: string;
  beforeEach(() => {
    seedOutlet(h);
    chicken = material(h, 'Test chicken', 'kg', { qtyMilli: 10_000, unitCostPaise: 24_000 });
    butter = material(h, 'Test butter', 'kg', { qtyMilli: 2000, unitCostPaise: 50_000 });
    flour = material(h, 'Test flour', 'kg', { qtyMilli: 100, unitCostPaise: 4000 });
    orderId = o.open(S.t1, 2).order!.id;
  });

  it('firing uses the variant recipe (else the item recipe) × qty, plus add-on recipes × add-on qty, per KOT', () => {
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.tandooriChicken, lines: [{ stockItemId: chicken, qtyMilli: 900 }] });
    h.run('SetRecipe', { ownerKind: 'variant', ownerId: S.tcHalf, lines: [{ stockItemId: chicken, qtyMilli: 450 }] });
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.butterNaan, lines: [{ stockItemId: flour, qtyMilli: 80 }, { stockItemId: butter, qtyMilli: 10 }] });
    h.run('SetRecipe', { ownerKind: 'addon', ownerId: S.butter, lines: [{ stockItemId: butter, qtyMilli: 15 }] });

    o.run('AddItems', orderId, {
      items: [line(S.tandooriChicken, { variantId: S.tcHalf, qty: 2 }), line(S.butterNaan, { qty: 3, addons: [{ addonId: S.butter, qty: 2 }] }), line(S.dalMakhani)],
    });
    const kots = (o.run('FireKOT', orderId, { all: true }).result as { kots: Array<{ id: string }> }).kots;

    expect(balance(h, chicken)).toBe(10_000 - 2 * 450);
    expect(balance(h, butter)).toBe(2000 - 3 * 10 - 2 * 15);
    expect(balance(h, flour)).toBe(100 - 240); // goes negative: stock never blocks a KOT
    const refs = h.db.prepare("SELECT DISTINCT ref_id FROM stock_movement WHERE kind = 'sale'").pluck().all();
    expect(kots.map((k) => k.id)).toEqual(expect.arrayContaining(refs));
    expect(listStock(h.db).find((s) => s.id === flour)).toMatchObject({ negative: true });
    expect(h.count('event_log', "event = 'stock.changed'")).toBeGreaterThan(0);
  });

  it('a variant without its own recipe uses the item recipe; items without a recipe use nothing', () => {
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.tandooriChicken, lines: [{ stockItemId: chicken, qtyMilli: 900 }] });
    const full = h.db.prepare("SELECT id FROM variant WHERE item_id = ? AND id <> ?").pluck().get(S.tandooriChicken, S.tcHalf) as string;
    o.run('AddItems', orderId, { items: [line(S.tandooriChicken, { variantId: full }), line(S.dalMakhani)] });
    o.run('FireKOT', orderId, { all: true });
    expect(balance(h, chicken)).toBe(9100);
    expect(h.count('stock_movement', `kind = 'sale' AND stock_item_id IN ('${chicken}', '${butter}', '${flour}')`)).toBe(1);
  });

  it('SetRecipe replaces the list; an empty list removes it; NOT_FOUND for an unknown owner', () => {
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.dalMakhani, lines: [{ stockItemId: butter, qtyMilli: 20 }, { stockItemId: flour, qtyMilli: 5 }] });
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.dalMakhani, lines: [{ stockItemId: butter, qtyMilli: 25 }] });
    expect(h.db.prepare('SELECT qty_milli FROM recipe_line WHERE owner_id = ?').pluck().all(S.dalMakhani)).toEqual([25]);
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.dalMakhani, lines: [] });
    expect(h.count('recipe_line', `owner_id = '${S.dalMakhani}'`)).toBe(0);
    h.fail('SetRecipe', { ownerKind: 'addon', ownerId: newId(), lines: [] }, 'NOT_FOUND');
    h.fail('SetRecipe', { ownerKind: 'item', ownerId: S.dalMakhani, lines: [{ stockItemId: butter, qtyMilli: 0 }] }, 'VALIDATION');
  });

  it('usage report: opening, received, used, wasted, adjusted and closing per material', () => {
    h.run('SetRecipe', { ownerKind: 'item', ownerId: S.dalMakhani, lines: [{ stockItemId: butter, qtyMilli: 20 }] });
    o.run('AddItems', orderId, { items: [line(S.dalMakhani, { qty: 5 })] });
    o.run('FireKOT', orderId, { all: true });
    h.run('AdjustStock', { kind: 'wastage', stockItemId: butter, qtyMilli: 100, reason: 'Melted' });
    const row = stockUsage(h.db, '2026-11-02', '2026-11-02').find((r) => r.stockItemId === butter)!;
    expect(row).toMatchObject({ openingMilli: 0, purchasedMilli: 2000, usedMilli: 100, wastedMilli: 100, adjustedMilli: 0, closingMilli: 1800, usedValuePaise: 5000, wastedValuePaise: 5000 });
    expect(row.closingMilli).toBe(balance(h, butter));
    const next = stockUsage(h.db, '2026-11-03', '2026-11-03').find((r) => r.stockItemId === butter)!;
    expect(next).toMatchObject({ openingMilli: 1800, usedMilli: 0, closingMilli: 1800 });
  });
});

describe('SetItemAvailability', () => {
  const h = useHarness();
  beforeEach(() => seedOutlet(h));

  it('marks sold out and back on, with menu.changed and an audit row; no-op when unchanged', () => {
    h.run('SetItemAvailability', { itemId: S.dalMakhani, available: false });
    expect(h.db.prepare('SELECT available FROM menu_item WHERE id = ?').pluck().get(S.dalMakhani)).toBe(0);
    h.run('SetItemAvailability', { itemId: S.dalMakhani, available: false });
    expect(h.count('audit_event', "action = 'menu_item.sold_out'")).toBe(1);
    h.run('SetItemAvailability', { itemId: S.dalMakhani, available: true });
    expect(h.count('audit_event', "action = 'menu_item.available'")).toBe(1);
  });

  it('FORBIDDEN without menu.stock; NOT_FOUND for an unknown item', () => {
    expect(h.fail('SetItemAvailability', { itemId: S.dalMakhani, available: false }, 'FORBIDDEN', { rights: denyAll }).details).toEqual({ right: 'menu.stock' });
    h.fail('SetItemAvailability', { itemId: newId(), available: false }, 'NOT_FOUND');
  });
});

describe('ImportMenu', () => {
  const h = useHarness();
  beforeEach(() => seedOutlet(h));
  const row = (name: string, extra: Record<string, unknown> = {}) => ({ name, category: 'Chef Specials', pricePaise: 45_000, taxRateBp: 500, shortCode: null, veg: true, hsnSac: null, ...extra });

  it('adds every item, creates missing categories once and reuses existing ones (ignoring case and spaces)', () => {
    const res = h.run('ImportMenu', { importId: newId(), items: [row('Galouti Kebab', { veg: false, shortCode: 'gk' }), row('Rose Kulfi', { category: '  mocktails ' }), row('Nihari')] });
    expect(res.result).toEqual({ imported: 3, categoriesCreated: 1 });
    expect(h.db.prepare("SELECT category_id FROM menu_item WHERE name = 'Rose Kulfi'").pluck().get()).toBe(S.mocktails);
    expect(h.db.prepare("SELECT short_code FROM menu_item WHERE name = 'Galouti Kebab'").pluck().get()).toBe('GK');
  });

  it('imports nothing when any row clashes with the menu or another row', () => {
    const before = h.count('menu_item');
    const err = h.fail('ImportMenu', { importId: newId(), items: [row('Nihari'), row('dal makhani'), row('X', { shortCode: 'PT' })] }, 'VALIDATION');
    expect((err.details as { problems: unknown[] }).problems).toHaveLength(2);
    expect(h.count('menu_item')).toBe(before);
  });

  it('FORBIDDEN without admin', () => {
    h.fail('ImportMenu', { importId: newId(), items: [row('Nihari')] }, 'FORBIDDEN', { rights: denyAll });
  });
});

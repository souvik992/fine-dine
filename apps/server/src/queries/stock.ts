// Reads for the Stock screen (docs/03 "Stock queries"). All amounts are computed here, never in the client.
import { stockAmount, type PurchaseView, type RecipeLineView, type StockItemView, type StockMovementView, type StockUnit, type StockUsageRow } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

interface ItemRow {
  id: string;
  name: string;
  unit: StockUnit;
  on_hand_milli: number;
  reorder_level_milli: number;
  last_unit_cost_paise: number | null;
  active: number;
  used_in: number;
}

export function listStock(db: Db): StockItemView[] {
  const rows = db
    .prepare(
      `SELECT s.*, (SELECT count(*) FROM recipe_line r WHERE r.stock_item_id = s.id) AS used_in
       FROM stock_item s ORDER BY s.active DESC, s.name COLLATE NOCASE`,
    )
    .all() as ItemRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    onHandMilli: r.on_hand_milli,
    reorderLevelMilli: r.reorder_level_milli,
    lastUnitCostPaise: r.last_unit_cost_paise,
    valuePaise: r.last_unit_cost_paise !== null && r.on_hand_milli > 0 ? stockAmount(r.on_hand_milli, r.last_unit_cost_paise) : 0,
    low: r.reorder_level_milli > 0 && r.on_hand_milli < r.reorder_level_milli,
    negative: r.on_hand_milli < 0,
    active: r.active === 1,
    usedIn: r.used_in,
  }));
}

export function stockMovements(db: Db, stockItemId: string, limit: number): StockMovementView[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.kind, m.delta_milli, m.reason, m.unit_cost_paise, m.business_date, m.at, u.name AS user_name,
         CASE m.ref_type
           WHEN 'kot' THEN (SELECT 'KOT ' || k.kot_no || coalesce(' · ' || t.label, '') FROM kot k JOIN "order" o ON o.id = k.order_id
                            LEFT JOIN dining_table t ON t.id = o.table_id WHERE k.id = m.ref_id)
           WHEN 'purchase' THEN (SELECT p.supplier_name || coalesce(' #' || p.invoice_no, '') FROM purchase p WHERE p.id = m.ref_id)
         END AS ref_text
       FROM stock_movement m LEFT JOIN app_user u ON u.id = m.user_id
       WHERE m.stock_item_id = ? ORDER BY m.seq DESC LIMIT ?`,
    )
    .all(stockItemId, limit) as Array<{
    id: string;
    kind: StockMovementView['kind'];
    delta_milli: number;
    reason: string | null;
    unit_cost_paise: number | null;
    business_date: string;
    at: string;
    user_name: string | null;
    ref_text: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    deltaMilli: r.delta_milli,
    refText: r.ref_text,
    reason: r.reason,
    unitCostPaise: r.unit_cost_paise,
    businessDate: r.business_date,
    at: r.at,
    userName: r.user_name,
  }));
}

interface PurchaseRow {
  id: string;
  supplier_name: string;
  supplier_gstin: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  note: string | null;
  total_paise: number;
  status: 'posted' | 'void';
  business_date: string;
  created_at: string;
  created_by_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

const PURCHASE_SELECT = `SELECT p.*, u.name AS created_by_name FROM purchase p LEFT JOIN app_user u ON u.id = p.created_by`;

function purchaseView(db: Db, r: PurchaseRow): PurchaseView {
  const lines = db
    .prepare(
      `SELECT l.stock_item_id, s.name, s.unit, l.qty_milli, l.unit_cost_paise, l.amount_paise
       FROM purchase_line l JOIN stock_item s ON s.id = l.stock_item_id WHERE l.purchase_id = ? ORDER BY l.line_no`,
    )
    .all(r.id) as Array<{ stock_item_id: string; name: string; unit: StockUnit; qty_milli: number; unit_cost_paise: number; amount_paise: number }>;
  return {
    id: r.id,
    supplierName: r.supplier_name,
    supplierGstin: r.supplier_gstin,
    invoiceNo: r.invoice_no,
    invoiceDate: r.invoice_date,
    note: r.note,
    totalPaise: r.total_paise,
    status: r.status,
    businessDate: r.business_date,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
    lines: lines.map((l) => ({ stockItemId: l.stock_item_id, name: l.name, unit: l.unit, qtyMilli: l.qty_milli, unitCostPaise: l.unit_cost_paise, amountPaise: l.amount_paise })),
  };
}

export function listPurchases(db: Db, limit: number, offset: number): PurchaseView[] {
  const rows = db.prepare(`${PURCHASE_SELECT} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(limit, offset) as PurchaseRow[];
  return rows.map((r) => purchaseView(db, r));
}

export function getPurchase(db: Db, id: string): PurchaseView | undefined {
  const row = db.prepare(`${PURCHASE_SELECT} WHERE p.id = ?`).get(id) as PurchaseRow | undefined;
  return row ? purchaseView(db, row) : undefined;
}

/** Supplier names already used, most recent first (for the purchase form). */
export function recentSuppliers(db: Db): Array<{ name: string; gstin: string | null }> {
  return db
    .prepare(
      `SELECT supplier_name AS name, supplier_gstin AS gstin FROM purchase WHERE rowid IN
         (SELECT max(rowid) FROM purchase GROUP BY supplier_name COLLATE NOCASE) ORDER BY created_at DESC LIMIT 50`,
    )
    .all() as Array<{ name: string; gstin: string | null }>;
}

export function listRecipes(db: Db): RecipeLineView[] {
  return db
    .prepare('SELECT owner_kind AS ownerKind, owner_id AS ownerId, stock_item_id AS stockItemId, qty_milli AS qtyMilli FROM recipe_line ORDER BY owner_kind, owner_id, stock_item_id')
    .all() as RecipeLineView[];
}

/**
 * Per material over business dates `from`..`to` (inclusive): balance before `from`, purchases (net of voids),
 * recipe use, wastage, counts and corrections, closing balance. Values at the material's last cost.
 */
export function stockUsage(db: Db, from: string, to: string): StockUsageRow[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.unit, s.last_unit_cost_paise AS cost,
         coalesce(sum(CASE WHEN m.business_date < @from THEN m.delta_milli END), 0) AS opening,
         coalesce(sum(CASE WHEN m.business_date BETWEEN @from AND @to AND m.kind IN ('purchase', 'purchase_void', 'opening') THEN m.delta_milli END), 0) AS purchased,
         coalesce(sum(CASE WHEN m.business_date BETWEEN @from AND @to AND m.kind = 'sale' THEN -m.delta_milli END), 0) AS used,
         coalesce(sum(CASE WHEN m.business_date BETWEEN @from AND @to AND m.kind = 'wastage' THEN -m.delta_milli END), 0) AS wasted,
         coalesce(sum(CASE WHEN m.business_date BETWEEN @from AND @to AND m.kind IN ('count', 'adjust') THEN m.delta_milli END), 0) AS adjusted
       FROM stock_item s LEFT JOIN stock_movement m ON m.stock_item_id = s.id AND m.business_date <= @to
       GROUP BY s.id
       HAVING s.active = 1 OR count(m.id) > 0
       ORDER BY s.name COLLATE NOCASE`,
    )
    .all({ from, to }) as Array<{ id: string; name: string; unit: StockUnit; cost: number | null; opening: number; purchased: number; used: number; wasted: number; adjusted: number }>;
  return rows.map((r) => ({
    stockItemId: r.id,
    name: r.name,
    unit: r.unit,
    openingMilli: r.opening,
    purchasedMilli: r.purchased,
    usedMilli: r.used,
    wastedMilli: r.wasted,
    adjustedMilli: r.adjusted,
    closingMilli: r.opening + r.purchased - r.used - r.wasted + r.adjusted,
    usedValuePaise: r.cost === null ? 0 : stockAmount(r.used, r.cost),
    wastedValuePaise: r.cost === null ? 0 : stockAmount(r.wasted, r.cost),
  }));
}

// Helpers shared by PrintBill, Settle and DayEnd.
import type { PaperWidth } from '@dinepos/printing';
import { isoInZone, type BillLineInput, type PricingMode } from '@dinepos/shared';
import type { OrderRow } from '../core/command-handler.js';
import type { OutletConfig } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

/** "dd-mm-yy" and "HH:MM" in the outlet zone, as printed on bills and reports. */
export function printedDateTime(at: Date, timeZone: string): { date: string; time: string } {
  const iso = isoInZone(at, timeZone); // 2026-11-02T20:14:05.000+05:30
  return { date: `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(2, 4)}`, time: iso.slice(11, 16) };
}

export interface BillPrinter {
  id: string;
  paper: PaperWidth;
}

/** The configured bill printer, else the first printer whose role is bill/both. Null when none exists. */
export function billPrinter(db: Db, cfg: OutletConfig): BillPrinter | null {
  const row = (cfg['bill.printerId']
    ? db.prepare('SELECT id, width_mm FROM printer WHERE id = ?').get(cfg['bill.printerId'])
    : db.prepare(`SELECT id, width_mm FROM printer WHERE role IN ('bill', 'both') ORDER BY name COLLATE NOCASE, id LIMIT 1`).get()) as
    | { id: string; width_mm: number }
    | undefined;
  return row ? { id: row.id, paper: row.width_mm === 58 ? 58 : 80 } : null;
}

export interface BillableItem {
  id: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  taxRateBp: number;
  addons: Array<{ name: string; qty: number; pricePaise: number }>;
}

/** Items the guest pays for: fired and not cancelled (held items must be sent or removed first). */
export function billableItems(db: Db, orderId: string): { items: BillableItem[]; heldCount: number } {
  const rows = db
    .prepare(`SELECT id, name_snapshot, qty, unit_price_paise, tax_rate_bp, status FROM order_item WHERE order_id = ? ORDER BY added_at, rowid`)
    .all(orderId) as Array<{ id: string; name_snapshot: string; qty: number; unit_price_paise: number; tax_rate_bp: number; status: string }>;
  const addonsOf = db.prepare('SELECT name_snapshot AS name, qty, price_paise AS pricePaise FROM order_item_addon WHERE order_item_id = ? ORDER BY rowid');
  return {
    heldCount: rows.filter((r) => r.status === 'held').length,
    items: rows
      .filter((r) => r.status === 'fired')
      .map((r) => ({
        id: r.id,
        name: r.name_snapshot,
        qty: r.qty,
        unitPricePaise: r.unit_price_paise,
        taxRateBp: r.tax_rate_bp,
        addons: addonsOf.all(r.id) as BillableItem['addons'],
      })),
  };
}

export function toBillLines(items: BillableItem[]): BillLineInput[] {
  return items.map((i) => ({
    id: i.id,
    qty: i.qty,
    unitPricePaise: i.unitPricePaise,
    taxRateBp: i.taxRateBp,
    addons: i.addons.map((a) => ({ qty: a.qty, pricePaise: a.pricePaise })),
  }));
}

export interface OrderPlace {
  tableLabel: string | null;
  areaName: string | null;
  pricingMode: PricingMode;
}

export function orderPlace(db: Db, order: OrderRow): OrderPlace {
  if (!order.table_id) return { tableLabel: null, areaName: null, pricingMode: 'exclusive' };
  const r = db
    .prepare(
      `SELECT t.label, a.name AS area, tp.pricing_mode FROM dining_table t JOIN area a ON a.id = t.area_id
       LEFT JOIN tax_profile tp ON tp.id = a.tax_profile_id WHERE t.id = ?`,
    )
    .get(order.table_id) as { label: string; area: string; pricing_mode: PricingMode | null } | undefined;
  return { tableLabel: r?.label ?? null, areaName: r?.area ?? null, pricingMode: r?.pricing_mode ?? 'exclusive' };
}

export function userName(db: Db, id: string | null): string | null {
  return id ? ((db.prepare('SELECT name FROM app_user WHERE id = ?').pluck().get(id) as string | undefined) ?? null) : null;
}

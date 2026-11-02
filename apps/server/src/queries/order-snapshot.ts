import {
  calculateBill,
  type BillSnapshot,
  type KotSnapshot,
  type OrderItemSnapshot,
  type OrderSnapshot,
  type PricingMode,
} from '@dinepos/shared';
import type { OrderRow } from '../core/command-handler.js';
import type { Db } from '../db/connection.js';

interface ItemRow {
  id: string;
  item_id: string;
  variant_id: string | null;
  name_snapshot: string;
  qty: number;
  unit_price_paise: number;
  tax_rate_bp: number;
  note: string | null;
  course: number;
  station_id: string | null;
  kot_id: string | null;
  kot_no: number | null;
  status: OrderItemSnapshot['status'];
}

interface AddonRow {
  order_item_id: string;
  addon_id: string;
  name_snapshot: string;
  qty: number;
  price_paise: number;
}

interface KotRow {
  id: string;
  kot_no: number;
  station_id: string;
  kind: KotSnapshot['kind'];
  fired_at: string;
  ready_at: string | null;
  served_at: string | null;
}

interface BillRow {
  id: string;
  bill_no: number | null;
  fy: string;
  split_no: number;
  total_paise: number;
  state: BillSnapshot['state'];
  paid_paise: number;
}

interface TableRow {
  id: string;
  label: string;
  area_id: string;
  pricing_mode: PricingMode | null;
}

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export function loadOrderRow(db: Db, orderId: string): OrderRow | undefined {
  return db.prepare('SELECT * FROM "order" WHERE id = ?').get(orderId) as OrderRow | undefined;
}

/** Full order snapshot (docs/03-command-api.md "Order snapshot shape"). Undefined when the order does not exist. */
export function getOrderSnapshot(db: Db, orderId: string): OrderSnapshot | undefined {
  const order = loadOrderRow(db, orderId);
  if (!order) return undefined;

  const table = order.table_id
    ? (db
        .prepare(
          `SELECT t.id, t.label, t.area_id, tp.pricing_mode FROM dining_table t
           JOIN area a ON a.id = t.area_id LEFT JOIN tax_profile tp ON tp.id = a.tax_profile_id
           WHERE t.id = ?`,
        )
        .get(order.table_id) as TableRow | undefined)
    : undefined;

  const itemRows = db
    .prepare(
      `SELECT oi.*, k.kot_no FROM order_item oi LEFT JOIN kot k ON k.id = oi.kot_id
       WHERE oi.order_id = ? ORDER BY oi.added_at, oi.id`,
    )
    .all(orderId) as ItemRow[];
  const addonRows = db
    .prepare(
      `SELECT a.* FROM order_item_addon a JOIN order_item oi ON oi.id = a.order_item_id
       WHERE oi.order_id = ? ORDER BY a.order_item_id, a.addon_id`,
    )
    .all(orderId) as AddonRow[];
  const addonsByItem = new Map<string, AddonRow[]>();
  for (const a of addonRows) addonsByItem.set(a.order_item_id, [...(addonsByItem.get(a.order_item_id) ?? []), a]);

  const items: OrderItemSnapshot[] = itemRows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    variantId: opt(r.variant_id),
    name: r.name_snapshot,
    qty: r.qty,
    unitPricePaise: r.unit_price_paise,
    taxRateBp: r.tax_rate_bp,
    addons: (addonsByItem.get(r.id) ?? []).map((a) => ({
      addonId: a.addon_id,
      name: a.name_snapshot,
      qty: a.qty,
      pricePaise: a.price_paise,
    })),
    note: opt(r.note),
    course: r.course,
    stationId: opt(r.station_id),
    status: r.status,
    kotId: opt(r.kot_id),
    kotNo: opt(r.kot_no),
  }));

  const kots: KotSnapshot[] = (
    db
      .prepare('SELECT id, kot_no, station_id, kind, fired_at, ready_at, served_at FROM kot WHERE order_id = ? ORDER BY fired_at, kot_no')
      .all(orderId) as KotRow[]
  ).map((k) => ({
    id: k.id,
    kotNo: k.kot_no,
    stationId: k.station_id,
    kind: k.kind,
    firedAt: k.fired_at,
    readyAt: opt(k.ready_at),
    servedAt: opt(k.served_at),
  }));

  const bills: BillSnapshot[] = (
    db
      .prepare(
        `SELECT b.id, b.bill_no, b.fy, b.split_no, b.total_paise, b.state,
                COALESCE((SELECT sum(p.amount_paise) FROM payment p WHERE p.bill_id = b.id), 0) AS paid_paise
         FROM bill b WHERE b.order_id = ? ORDER BY b.split_no, b.id`,
      )
      .all(orderId) as BillRow[]
  ).map((b) => ({
    id: b.id,
    billNo: opt(b.bill_no),
    fy: b.fy,
    splitNo: b.split_no,
    totalPaise: b.total_paise,
    state: b.state,
    paidPaise: b.paid_paise,
  }));

  const live = items.filter((i) => i.status !== 'cancelled');
  const calc = calculateBill(
    live.map((i) => ({ id: i.id, qty: i.qty, unitPricePaise: i.unitPricePaise, taxRateBp: i.taxRateBp, addons: i.addons })),
    { pricingMode: table?.pricing_mode ?? 'exclusive', roundOffStep: 0 },
  );

  return {
    id: order.id,
    version: order.version,
    state: order.state,
    type: order.type,
    businessDate: order.business_date,
    table: table ? { id: table.id, label: table.label, areaId: table.area_id } : undefined,
    covers: order.covers ?? 0,
    captainId: opt(order.captain_id),
    openedAt: order.opened_at,
    lastKotAt: opt(order.last_kot_at),
    billPrintedAt: opt(order.bill_printed_at),
    items,
    kots,
    bills,
    totals: { subtotalPaise: calc.subtotal, taxPaise: calc.totalTax, totalPaise: calc.total },
  };
}

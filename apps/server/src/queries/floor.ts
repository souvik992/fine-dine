import { deriveTableState, isoInZone, type FloorSnapshot, type FloorTable } from '@dinepos/shared';
import type { Db } from '../db/connection.js';
import { sectionCaptains } from '../commands/captain-support.js';
import { billRequestOf, getOrderSnapshot } from './order-snapshot.js';

interface FloorRow {
  id: string;
  area_id: string;
  label: string;
  seats: number | null;
  layout_x: number | null;
  layout_y: number | null;
  status: 'active' | 'reserved' | 'blocked';
  order_id: string | null;
  order_version: number | null;
  covers: number | null;
  captain_id: string | null;
  captain_name: string | null;
  opened_at: string | null;
  last_kot_at: string | null;
  bill_printed_at: string | null;
  has_kot: number;
}

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Areas and tables with derived state (docs/02 deriveTableState), elapsed time and running amount. */
export function getFloor(db: Db, now: Date, timeZone: string): FloorSnapshot {
  const areas = db.prepare('SELECT id, name, sort FROM area ORDER BY sort, name COLLATE NOCASE').all() as FloorSnapshot['areas'];
  const areaOrder = new Map(areas.map((a, i) => [a.id, i]));

  const rows = db
    .prepare(
      `SELECT t.id, t.area_id, t.label, t.seats, t.layout_x, t.layout_y, t.status,
              o.id AS order_id, o.version AS order_version, o.covers, o.captain_id, cu.name AS captain_name, o.opened_at,
              o.last_kot_at, o.bill_printed_at,
              (EXISTS (SELECT 1 FROM kot k WHERE k.order_id = o.id) OR EXISTS (SELECT 1 FROM order_item i WHERE i.order_id = o.id AND i.kot_id IS NOT NULL)) AS has_kot
       FROM dining_table t
       LEFT JOIN "order" o ON o.id = t.open_order_id AND o.state IN ('open', 'billed')
       LEFT JOIN app_user cu ON cu.id = o.captain_id`,
    )
    .all() as FloorRow[];

  const tables: FloorTable[] = rows.map((r) => {
    const order = r.order_id
      ? { hasFiredKot: r.has_kot === 1, lastKotAt: r.last_kot_at, billPrintedAt: r.bill_printed_at }
      : null;
    const table: FloorTable = {
      id: r.id,
      areaId: r.area_id,
      label: r.label,
      seats: opt(r.seats),
      layoutX: opt(r.layout_x),
      layoutY: opt(r.layout_y),
      state: deriveTableState({ status: r.status }, order),
    };
    const section = sectionCaptains(db, r.id);
    if (section.length) table.sectionCaptainIds = section;
    if (r.order_id) {
      table.orderId = r.order_id;
      table.orderVersion = r.order_version ?? undefined;
      table.covers = r.covers ?? 0;
      table.captainId = opt(r.captain_id);
      table.captainName = opt(r.captain_name);
      Object.assign(table, billRequestOf(db, r.order_id));
      table.since = opt(r.opened_at);
      if (r.opened_at) table.elapsedMin = Math.max(0, Math.floor((now.getTime() - Date.parse(r.opened_at)) / 60_000));
      table.amountPaise = getOrderSnapshot(db, r.order_id)?.totals.totalPaise ?? 0;
    }
    return table;
  });

  tables.sort(
    (a, b) => (areaOrder.get(a.areaId) ?? 0) - (areaOrder.get(b.areaId) ?? 0) || collator.compare(a.label, b.label),
  );
  return { serverTime: isoInZone(now, timeZone), areas, tables };
}

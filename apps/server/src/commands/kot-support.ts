// Issuing and reprinting kitchen tickets (docs/06 "KOT"). Every ticket is stored as printed (kot_document) so a
// reprint matches the original; tickets go to every printer of the station and to the KDS stream.
import { onlineRef } from '../online/online-support.js';
import { renderKot, type KotKind, type KotTicket, type KotTicketLine, type PaperWidth } from '@dinepos/printing';
import { isoInZone, newId } from '@dinepos/shared';
import type { OrderRow } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { nextCounter } from './order-support.js';

type TicketHeader = Omit<KotTicket, 'kotNo' | 'kind' | 'stationName' | 'lines'>;

/** Table, covers, captain and the local time as printed on every ticket of this command. */
export function kotHeader(ctx: CommandContext, order: OrderRow): TicketHeader {
  const { db } = ctx;
  const table = order.table_id
    ? (db.prepare('SELECT t.label, a.name AS area FROM dining_table t JOIN area a ON a.id = t.area_id WHERE t.id = ?').get(order.table_id) as
        | { label: string; area: string }
        | undefined)
    : undefined;
  const captainName = order.captain_id ? (db.prepare('SELECT name FROM app_user WHERE id = ?').pluck().get(order.captain_id) as string | undefined) : undefined;
  const local = isoInZone(ctx.now, ctx.timeZone); // 2026-11-02T20:14:05.000+05:30
  return {
    orderType: order.type,
    tableLabel: table?.label ?? null,
    ...(order.type === 'online' ? { orderRef: onlineRef(db, order.id) } : {}),
    areaName: table?.area ?? null,
    covers: order.covers,
    captainName: captainName ?? null,
    time: local.slice(11, 16),
    date: `${local.slice(8, 10)}-${local.slice(5, 7)}-${local.slice(2, 4)}`,
  };
}

/** Prints a ticket on every printer of the station. */
function printTicket(ctx: CommandContext, stationId: string, kotId: string, ticket: KotTicket): void {
  const printers = ctx.db.prepare('SELECT p.id, p.width_mm FROM station_printer sp JOIN printer p ON p.id = sp.printer_id WHERE sp.station_id = ? ORDER BY p.name').all(stationId) as Array<{
    id: string;
    width_mm: number;
  }>;
  for (const printer of printers) {
    const { bytes, preview } = renderKot(ticket, { paper: (printer.width_mm === 58 ? 58 : 80) satisfies PaperWidth });
    ctx.print({ printerId: printer.id, docKind: 'kot', refId: kotId, bytes, previewText: preview });
  }
}

/**
 * Creates a KOT (new, modify or cancel slip): next number of the business day, stored ticket, printed on the
 * station's printers, announced on `station:<id>` and `kds`.
 */
export function issueKot(
  ctx: CommandContext,
  order: OrderRow,
  station: { id: string; name: string },
  kind: KotKind,
  lines: KotTicketLine[],
  header: TicketHeader,
  change?: { forKotNo: number; reason: string },
): { id: string; kotNo: number; ticket: KotTicket } {
  const kotId = newId();
  const kotNo = nextCounter(ctx.db, `kot_no:${ctx.businessDate}`);
  ctx.db
    .prepare(`INSERT INTO kot (id, order_id, station_id, business_date, kot_no, kind, fired_at, fired_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(kotId, order.id, station.id, ctx.businessDate, kotNo, kind, ctx.nowIso, ctx.actor.userId);
  const ticket: KotTicket = { kotNo, kind, stationName: station.name, ...header, lines, ...(change ? { forKotNo: change.forKotNo, reason: change.reason } : {}) };
  ctx.db.prepare('INSERT INTO kot_document (kot_id, ticket_json, created_at, command_id) VALUES (?, ?, ?, ?)').run(kotId, JSON.stringify(ticket), ctx.nowIso, ctx.commandId);
  printTicket(ctx, station.id, kotId, ticket);
  ctx.emit([`station:${station.id}`, 'kds'], 'kot.created', { kotId, orderId: order.id, ...ticket });
  return { id: kotId, kotNo, ticket };
}

/** The stored ticket, marked DUPLICATE, on the station's printers. Tickets from before migration 0006 are rebuilt. */
export function reprintKot(ctx: CommandContext, kotId: string): { kotNo: number; stationId: string; orderId: string } {
  const { db } = ctx;
  const kot = db.prepare('SELECT k.id, k.order_id, k.station_id, k.kot_no, k.kind, s.name AS station FROM kot k JOIN station s ON s.id = k.station_id WHERE k.id = ?').get(kotId) as
    | { id: string; order_id: string; station_id: string; kot_no: number; kind: KotKind; station: string }
    | undefined;
  if (!kot) throw new PosError('NOT_FOUND', 'That KOT does not exist.', { kotId });
  const stored = db.prepare('SELECT ticket_json FROM kot_document WHERE kot_id = ?').pluck().get(kotId) as string | undefined;
  let ticket: KotTicket;
  if (stored) ticket = JSON.parse(stored) as KotTicket;
  else {
    const order = db.prepare('SELECT * FROM "order" WHERE id = ?').get(kot.order_id) as OrderRow;
    const addonsOf = db.prepare('SELECT name_snapshot AS name, qty FROM order_item_addon WHERE order_item_id = ? ORDER BY name_snapshot');
    const items = db.prepare(`SELECT id, name_snapshot, qty, note, course FROM order_item WHERE kot_id = ? AND status = 'fired' ORDER BY added_at, rowid`).all(kotId) as Array<{
      id: string;
      name_snapshot: string;
      qty: number;
      note: string | null;
      course: number;
    }>;
    ticket = {
      kotNo: kot.kot_no,
      kind: kot.kind,
      stationName: kot.station,
      ...kotHeader(ctx, order),
      lines: items.map((i) => ({ qty: i.qty, name: i.name_snapshot, course: i.course, note: i.note, addons: addonsOf.all(i.id) as Array<{ name: string; qty: number }> })),
    };
  }
  printTicket(ctx, kot.station_id, kot.id, { ...ticket, duplicate: true });
  db.prepare('UPDATE kot SET reprint_count = reprint_count + 1 WHERE id = ?').run(kotId);
  return { kotNo: kot.kot_no, stationId: kot.station_id, orderId: kot.order_id };
}

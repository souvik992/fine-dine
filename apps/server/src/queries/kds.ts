// The kitchen screen's board (P4-02, docs/06 "KDS"): one station's tickets of the business day that are not served
// yet, oldest first, exactly as printed (kot_document) plus their timings.
import { isoInZone, type KdsBoard, type KdsTicket, type KdsToday } from '@dinepos/shared';
import { currentBusinessDate } from '../core/business-day.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import type { Db } from '../db/connection.js';

interface Row {
  id: string;
  order_id: string;
  kot_no: number;
  kind: KdsTicket['kind'];
  fired_at: string;
  ready_at: string | null;
  ticket_json: string;
}

export function getKdsBoard(db: Db, stationId: string, now: Date, timeZone: string): KdsBoard {
  const station = db.prepare('SELECT id, name FROM station WHERE id = ?').get(stationId) as { id: string; name: string } | undefined;
  if (!station) throw new PosError('NOT_FOUND', 'Kitchen station not found.', { stationId });
  const config = getConfig(db);
  const day = currentBusinessDate(db);
  // Paid or voided orders are finished: a ticket nobody bumped does not stay on the screen for ever.
  const rows = day
    ? (db
        .prepare(
          `SELECT k.id, k.order_id, k.kot_no, k.kind, k.fired_at, k.ready_at, d.ticket_json
           FROM kot k JOIN kot_document d ON d.kot_id = k.id JOIN "order" o ON o.id = k.order_id
           WHERE k.station_id = ? AND k.business_date = ? AND k.served_at IS NULL AND o.state NOT IN ('settled', 'void')
           ORDER BY k.fired_at, k.kot_no`,
        )
        .all(station.id, day) as Row[])
    : [];
  const tickets = rows.map((r): KdsTicket => {
    const t = JSON.parse(r.ticket_json) as Omit<KdsTicket, 'id' | 'orderId' | 'firedAt' | 'readyAt' | 'kind' | 'kotNo'>;
    return {
      id: r.id,
      kotNo: r.kot_no,
      kind: r.kind,
      orderId: r.order_id,
      orderType: t.orderType,
      tableLabel: t.tableLabel ?? null,
      areaName: t.areaName ?? null,
      covers: t.covers ?? null,
      captainName: t.captainName ?? null,
      firedAt: r.fired_at,
      ...(r.ready_at ? { readyAt: r.ready_at } : {}),
      lines: t.lines,
      forKotNo: t.forKotNo ?? null,
      reason: t.reason ?? null,
      notice: t.notice ?? null,
    };
  });
  const amberMin = config['kds.amberMin'];
  const today = day ? stationDay(db, station.id, day, amberMin) : { served: 0, bumped: 0, avgReadySec: null, late: 0 };
  return { serverTime: isoInZone(now, timeZone), station, amberMin, redMin: Math.max(config['kds.redMin'], amberMin + 1), tickets, today };
}

/** The station's tickets of the business day (change slips and move notices left out): served, bumped, speed. */
function stationDay(db: Db, stationId: string, day: string, amberMin: number): KdsToday {
  const r = db
    .prepare(
      `SELECT sum(CASE WHEN served_at IS NOT NULL THEN 1 ELSE 0 END) AS served,
              sum(CASE WHEN ready_at IS NOT NULL THEN 1 ELSE 0 END) AS bumped,
              avg(CASE WHEN ready_at IS NOT NULL THEN (julianday(ready_at) - julianday(fired_at)) * 86400 END) AS avgSec,
              sum(CASE WHEN ready_at IS NOT NULL AND round((julianday(ready_at) - julianday(fired_at)) * 86400) > ? * 60 THEN 1 ELSE 0 END) AS late
       FROM kot WHERE station_id = ? AND business_date = ? AND kind = 'new'`,
    )
    .get(amberMin, stationId, day) as { served: number | null; bumped: number | null; avgSec: number | null; late: number | null };
  return { served: r.served ?? 0, bumped: r.bumped ?? 0, avgReadySec: r.avgSec === null ? null : Math.round(r.avgSec), late: r.late ?? 0 };
}

// What the kitchen screens say about an order's food, for the floor (tile chips, table state) and `table.state`.
import { kitchenLevel, localDate, type TableKitchen, type TableStateKitchen } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

/**
 * Stations that use a kitchen screen: marked so in Settings › Kitchen & printers, or with a ticket bumped (ready or
 * served) on a screen in the last 7 business days (a screen works for any station). Paper-only stations never report.
 */
export function screenStations(db: Db, now: Date, timeZone: string): Set<string> {
  const since = localDate(new Date(now.getTime() - 7 * 86_400_000), timeZone);
  return new Set(
    db
      .prepare(`SELECT id FROM station WHERE has_kds = 1 UNION SELECT DISTINCT station_id FROM kot WHERE business_date >= ? AND (ready_at IS NOT NULL OR served_at IS NOT NULL)`)
      .pluck()
      .all(since) as string[],
  );
}

export interface KitchenCounts extends TableStateKitchen {
  /** When the oldest cooking ticket was sent; null when none is cooking. */
  cookingSince: string | null;
}

/**
 * The order's tickets with food still on it (fully cancelled ones are left out): at a screen station they are
 * cooking, ready or served; elsewhere nobody reports, so they are `unknown`. Null when there are none.
 */
export function kitchenCounts(db: Db, orderId: string, stations: Set<string>): KitchenCounts | null {
  const kots = db
    .prepare(
      `SELECT station_id, fired_at, ready_at, served_at FROM kot
       WHERE kind = 'new' AND id IN (SELECT kot_id FROM order_item WHERE order_id = ? AND status = 'fired' AND kot_id IS NOT NULL)`,
    )
    .all(orderId) as Array<{ station_id: string; fired_at: string; ready_at: string | null; served_at: string | null }>;
  if (kots.length === 0) return null;
  const c: KitchenCounts = { cooking: 0, ready: 0, served: 0, unknown: 0, cookingSince: null };
  for (const k of kots) {
    if (!stations.has(k.station_id)) c.unknown++;
    else if (k.served_at) c.served++;
    else if (k.ready_at) c.ready++;
    else {
      c.cooking++;
      if (!c.cookingSince || k.fired_at < c.cookingSince) c.cookingSince = k.fired_at;
    }
  }
  return c;
}

/** The tile's chips: tickets cooking (and for how long) and ready to serve; null when neither. */
export function tableKitchen(c: KitchenCounts | null, now: Date, limits: { amberMin: number; redMin: number }): TableKitchen | null {
  if (!c || (c.cooking === 0 && c.ready === 0)) return null;
  const waitingMin = c.cookingSince ? Math.max(0, Math.floor((now.getTime() - Date.parse(c.cookingSince)) / 60_000)) : null;
  return { cooking: c.cooking, ready: c.ready, cookingSince: c.cookingSince, waitingMin, level: kitchenLevel(waitingMin, limits), ...limits };
}

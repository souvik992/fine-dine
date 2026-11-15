// Cloud sync (P4-05): this database's stream and its outbox rows still to send.
import type { Db } from '../db/connection.js';

export function syncStream(db: Db): { streamId: string; startedAt: string } {
  const r = db.prepare('SELECT stream_id, started_at FROM sync_state WHERE id = 1').get() as { stream_id: string; started_at: string };
  return { streamId: r.stream_id, startedAt: r.started_at };
}

/**
 * The outlet's stock as it is now, for the portal's "Purchases & stock" page (PUT /v1/pos/inventory): every active
 * material, and for each recent business day what sales used and what was wasted, valued at the material's last cost.
 */
export function stockSnapshot(db: Db, sinceDate: string): { items: Array<{ id: string; name: string; unit: string; onHandMilli: number; reorderMilli: number; unitCostPaise: number | null }>; usage: Array<{ date: string; usedPaise: number; wastePaise: number }> } {
  return {
    items: db
      .prepare('SELECT id, name, unit, on_hand_milli AS onHandMilli, reorder_level_milli AS reorderMilli, last_unit_cost_paise AS unitCostPaise FROM stock_item WHERE active = 1 ORDER BY id')
      .all() as ReturnType<typeof stockSnapshot>['items'],
    usage: db
      .prepare(
        `SELECT m.business_date AS date,
                max(0, sum(CASE WHEN m.kind = 'sale' THEN -m.delta_milli * COALESCE(s.last_unit_cost_paise, 0) ELSE 0 END) / 1000) AS usedPaise,
                max(0, sum(CASE WHEN m.kind = 'wastage' THEN -m.delta_milli * COALESCE(s.last_unit_cost_paise, 0) ELSE 0 END) / 1000) AS wastePaise
         FROM stock_movement m JOIN stock_item s ON s.id = m.stock_item_id
         WHERE m.business_date >= ? AND m.kind IN ('sale', 'wastage') GROUP BY m.business_date ORDER BY m.business_date`,
      )
      .all(sinceDate) as ReturnType<typeof stockSnapshot>['usage'],
  };
}

export interface OutboxRow {
  seq: number;
  kind: string;
  payload_json: string;
  created_at: string;
}

/** The oldest unsent rows, in order (the unsent rows always follow the sent ones). */
export function unsentRows(db: Db, limit: number): OutboxRow[] {
  return db.prepare('SELECT seq, kind, payload_json, created_at FROM outbox WHERE sent_at IS NULL ORDER BY seq LIMIT ?').all(limit) as OutboxRow[];
}

export function pendingSummary(db: Db): { pending: number; oldestPendingAt: string | null } {
  const r = db.prepare('SELECT count(*) AS n, min(created_at) AS oldest FROM outbox WHERE sent_at IS NULL').get() as { n: number; oldest: string | null };
  return { pending: r.n, oldestPendingAt: r.oldest };
}

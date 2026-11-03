// Cloud sync (P4-05): this database's stream and its outbox rows still to send.
import type { Db } from '../db/connection.js';

export function syncStream(db: Db): { streamId: string; startedAt: string } {
  const r = db.prepare('SELECT stream_id, started_at FROM sync_state WHERE id = 1').get() as { stream_id: string; started_at: string };
  return { streamId: r.stream_id, startedAt: r.started_at };
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

// P2-15: the outlet server's identity, so a kitchen screen can recognise "its" server at a new IP address.
// Kept in the `config` table (not a setting: not in configSchemas, so SetConfig cannot change it), which means it
// travels with the database: a restore on a replacement PC keeps it and paired kitchen screens follow.
import { newId } from '@dinepos/shared';
import type { Db } from '../db/connection.js';

export const SERVER_ID_KEY = 'server.id';

export function readServerId(db: Db): string | null {
  const raw = db.prepare('SELECT value FROM config WHERE key = ?').pluck().get(SERVER_ID_KEY) as string | undefined;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** At startup, before listening: the id, made once. */
export function ensureServerId(db: Db, make: () => string = newId): string {
  const existing = readServerId(db);
  if (existing) return existing;
  const id = make();
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(SERVER_ID_KEY, JSON.stringify(id));
  return id;
}

import Database from 'better-sqlite3';
import { StartupError } from '../core/errors.js';

export type Db = Database.Database;

const MEMORY = ':memory:';

/**
 * Opens the one write connection (single-writer rule, ADR-0001) and applies the pragmas the
 * durability guarantees depend on. Each pragma is read back: a silently ignored pragma would mean
 * committed bills could be lost on a power cut.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  try {
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
    db.pragma('temp_store = MEMORY');
    const mode = db.pragma('journal_mode = WAL', { simple: true }) as string;
    db.pragma('synchronous = FULL');

    const expectedMode = file === MEMORY ? 'memory' : 'wal';
    if (mode !== expectedMode) fail(`journal_mode is "${mode}", expected "${expectedMode}"`);
    if (db.pragma('synchronous', { simple: true }) !== 2) fail('synchronous is not FULL');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) fail('foreign_keys is not ON');
  } catch (err) {
    // Windows keeps open files locked; a refused database must not stay open.
    db.close();
    throw err;
  }
  return db;
}

/** Checkpoints the WAL into the main file and closes. Safe to call twice. */
export function closeDatabase(db: Db): void {
  if (!db.open) return;
  try {
    if (!db.memory) db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
}

function fail(reason: string): never {
  throw new StartupError('DB_PRAGMA', `Database refused a required setting: ${reason}.`);
}

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StartupError } from '../core/errors.js';
import type { Db } from './connection.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  sha256: string;
}

export interface MigrationResult {
  applied: number[];
  schemaVersion: number;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

const FILE_RE = /^(\d{4})_([a-z0-9][a-z0-9_-]*)\.sql$/;

export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Reads `NNNN_name.sql` files. Versions must run 1, 2, 3… with no gaps or duplicates. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.toLowerCase().endsWith('.sql')) continue;
    const m = FILE_RE.exec(file);
    if (!m) throw new StartupError('MIGRATION_FILE', `Migration file "${file}" must be named NNNN_name.sql.`);
    const sql = readFileSync(path.join(dir, file), 'utf8');
    migrations.push({ version: Number(m[1]), name: m[2]!, sql, sha256: checksum(sql) });
  }
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new StartupError(
        'MIGRATION_FILE',
        `Migrations must be numbered 0001, 0002, … without gaps; found ${String(m.version).padStart(4, '0')} at position ${i + 1}.`,
      );
    }
  });
  return migrations;
}

/**
 * Brings the schema up to date. Each migration runs in its own IMMEDIATE transaction together with
 * its schema_migrations (and checksum) row, so a failure leaves the database at the previous version.
 * Refuses a database that is newer than this build, or whose applied migrations were edited.
 */
export function migrate(db: Db, migrations: Migration[] = loadMigrations(), now: () => Date = () => new Date()): MigrationResult {
  const known = new Map(migrations.map((m) => [m.version, m]));
  const applied = appliedVersions(db);

  for (const row of applied) {
    const m = known.get(row.version);
    if (!m) {
      throw new StartupError(
        'SCHEMA_TOO_NEW',
        `The database is at schema v${maxVersion(applied)}, newer than this server understands (v${migrations.length}). ` +
          'Install the newer DinePOS version; never downgrade.',
      );
    }
    if (m.name !== row.name || (row.sha256 !== null && row.sha256 !== m.sha256)) {
      throw new StartupError(
        'MIGRATION_CHECKSUM',
        `Migration ${row.version} (${row.name}) was changed after it was applied. Restore the original file; ` +
          'schema changes go in a new migration.',
      );
    }
  }

  const done = new Set(applied.map((a) => a.version));
  const newlyApplied: number[] = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        now().toISOString(),
      );
      recordChecksums(db, known);
    }).immediate();
    newlyApplied.push(m.version);
  }

  return { applied: newlyApplied, schemaVersion: migrations.length };
}

export function schemaVersion(db: Db): number {
  return maxVersion(appliedVersions(db));
}

interface AppliedRow {
  version: number;
  name: string;
  sha256: string | null;
}

function tableExists(db: Db, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
}

function appliedVersions(db: Db): AppliedRow[] {
  if (!tableExists(db, 'schema_migrations')) return [];
  const hasChecksums = tableExists(db, 'schema_migration_checksum');
  const sql = hasChecksums
    ? `SELECT m.version, m.name, c.sha256 FROM schema_migrations m
       LEFT JOIN schema_migration_checksum c ON c.version = m.version ORDER BY m.version`
    : 'SELECT version, name, NULL AS sha256 FROM schema_migrations ORDER BY version';
  return db.prepare(sql).all() as AppliedRow[];
}

/** Stores the checksum of every applied migration that lacks one (backfills those before 0002). */
function recordChecksums(db: Db, known: Map<number, Migration>): void {
  if (!tableExists(db, 'schema_migration_checksum')) return;
  const missing = db
    .prepare(
      `SELECT m.version FROM schema_migrations m
       WHERE NOT EXISTS (SELECT 1 FROM schema_migration_checksum c WHERE c.version = m.version)`,
    )
    .pluck()
    .all() as number[];
  const insert = db.prepare('INSERT INTO schema_migration_checksum (version, sha256) VALUES (?, ?)');
  for (const v of missing) insert.run(v, known.get(v)!.sha256);
}

function maxVersion(rows: AppliedRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.version), 0);
}

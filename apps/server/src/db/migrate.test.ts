import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from './connection.js';
import { checksum, loadMigrations, migrate, schemaVersion, type Migration } from './migrate.js';

const fixed = () => new Date('2026-11-02T10:00:00Z');
const mig = (version: number, name: string, sql: string): Migration => ({ version, name, sql, sha256: checksum(sql) });

let db: Db | undefined;
const dirs: string[] = [];
afterEach(() => {
  db?.close();
  db = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'dinepos-mig-'));
  dirs.push(d);
  return d;
}

describe('loadMigrations', () => {
  it('loads the shipped migrations in order, starting at 0001_init', () => {
    const all = loadMigrations();
    expect(all.map((m) => m.version)).toEqual(all.map((_, i) => i + 1));
    expect(all[0]?.name).toBe('init');
  });

  it('rejects badly named .sql files', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, '0001_init.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, '2_oops.sql'), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/NNNN_name\.sql/);
  });

  it('rejects gaps in numbering', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, '0001_init.sql'), 'SELECT 1;');
    writeFileSync(path.join(dir, '0003_later.sql'), 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/without gaps/);
  });

  it('checksums ignore CRLF vs LF', () => {
    expect(checksum('A;\r\nB;\r\n')).toBe(checksum('A;\nB;\n'));
  });
});

describe('migrate', () => {
  it('applies every migration on a fresh database and records checksums', () => {
    db = openDatabase(':memory:');
    const all = loadMigrations();
    const result = migrate(db, all, fixed);
    expect(result.applied).toEqual(all.map((m) => m.version));
    expect(schemaVersion(db)).toBe(all.length);
    const sums = db.prepare('SELECT version, sha256 FROM schema_migration_checksum ORDER BY version').all();
    expect(sums).toEqual(all.map((m) => ({ version: m.version, sha256: m.sha256 })));
  });

  it('is a no-op the second time', () => {
    db = openDatabase(':memory:');
    migrate(db, undefined, fixed);
    expect(migrate(db, undefined, fixed).applied).toEqual([]);
    expect(db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()).toBe(loadMigrations().length);
  });

  it('applies only the new migration on upgrade', () => {
    db = openDatabase(':memory:');
    const base = loadMigrations();
    migrate(db, base, fixed);
    const next = mig(base.length + 1, 'add_widget', 'CREATE TABLE widget (id TEXT PRIMARY KEY);');
    expect(migrate(db, [...base, next], fixed).applied).toEqual([next.version]);
    expect(schemaVersion(db)).toBe(next.version);
  });

  it('refuses a database newer than the build', () => {
    db = openDatabase(':memory:');
    const base = loadMigrations();
    migrate(db, [...base, mig(base.length + 1, 'future', 'CREATE TABLE future (id TEXT);')], fixed);
    expect(() => migrate(db!, base, fixed)).toThrow(expect.objectContaining({ code: 'SCHEMA_TOO_NEW' }));
  });

  it('refuses an applied migration whose SQL was edited', () => {
    db = openDatabase(':memory:');
    const base = loadMigrations();
    migrate(db, base, fixed);
    const edited = base.map((m) => (m.version === 1 ? mig(1, m.name, `${m.sql}\n-- sneaky edit`) : m));
    expect(() => migrate(db!, edited, fixed)).toThrow(expect.objectContaining({ code: 'MIGRATION_CHECKSUM' }));
  });

  it('rolls back a failing migration completely', () => {
    db = openDatabase(':memory:');
    const base = loadMigrations();
    migrate(db, base, fixed);
    const broken = mig(base.length + 1, 'broken', 'CREATE TABLE half_done (id TEXT); SELECT * FROM no_such_table;');
    expect(() => migrate(db!, [...base, broken], fixed)).toThrow(/no_such_table/);
    expect(schemaVersion(db)).toBe(base.length);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
  });

  it('keeps the checksum table append-only', () => {
    db = openDatabase(':memory:');
    migrate(db, undefined, fixed);
    expect(() => db!.exec("UPDATE schema_migration_checksum SET sha256 = 'x'")).toThrow(/append-only/);
    expect(() => db!.exec('DELETE FROM schema_migration_checksum')).toThrow(/append-only/);
  });
});

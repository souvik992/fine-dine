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

  it('0020 rebuilds the printer table keeping every printer and everything that points at one; foreign keys stay on', () => {
    db = openDatabase(':memory:');
    const all = loadMigrations();
    migrate(db, all.filter((m) => m.version < 20), fixed);
    db.exec(`INSERT INTO printer (id, name, transport, host, port, role) VALUES ('P1', 'Kitchen', 'tcp', '192.168.1.50', 9100, 'kot');
      INSERT INTO printer (id, name, transport, windows_name, role, backup_printer_id, copies) VALUES ('P2', 'Counter', 'usb', 'POS-80', 'bill', 'P1', 2);
      INSERT INTO station (id, name) VALUES ('S1', 'Kitchen');
      INSERT INTO station_printer (station_id, printer_id) VALUES ('S1', 'P1');
      INSERT INTO print_job (id, printer_id, doc_kind, bytes, created_at) VALUES ('J1', 'P2', 'test', x'00', '2026-11-02T10:00:00Z');`);
    expect(migrate(db, all, fixed).applied).toContain(20);
    expect(db.prepare('SELECT id, name, transport, host, windows_name, copies, backup_printer_id, role, profile, active, drawer, device FROM printer ORDER BY id').all()).toEqual([
      { id: 'P1', name: 'Kitchen', transport: 'tcp', host: '192.168.1.50', windows_name: null, copies: 1, backup_printer_id: null, role: 'kot', profile: 'generic', active: 1, drawer: 0, device: null },
      { id: 'P2', name: 'Counter', transport: 'usb', host: null, windows_name: 'POS-80', copies: 2, backup_printer_id: 'P1', role: 'bill', profile: 'generic', active: 1, drawer: 0, device: null },
    ]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    db.prepare("INSERT INTO printer (id, name, transport, device) VALUES ('P3', 'Bluetooth', 'serial', 'COM5')").run(); // the new connections
    expect(() => db!.prepare("DELETE FROM printer WHERE id = 'P1'").run()).toThrow(/FOREIGN KEY/); // the station still protects it
  });

  it('a foreign-keys-off migration that would leave a broken reference changes nothing', () => {
    db = openDatabase(':memory:');
    const base = loadMigrations();
    migrate(db, base, fixed);
    const bad = mig(base.length + 1, 'dangling', "-- dinepos: foreign-keys-off\nINSERT INTO station_printer (station_id, printer_id) VALUES ('nope', 'nope');");
    expect(() => migrate(db!, [...base, bad], fixed)).toThrow(expect.objectContaining({ code: 'MIGRATION_FK' }));
    expect(schemaVersion(db)).toBe(base.length);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
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

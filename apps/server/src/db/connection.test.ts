import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, type Db } from './connection.js';

let db: Db | undefined;
let dir: string | undefined;
afterEach(() => {
  if (db) closeDatabase(db);
  db = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('openDatabase', () => {
  it('applies the durability pragmas on a file database', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'dinepos-conn-'));
    db = openDatabase(path.join(dir, 'test.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('synchronous', { simple: true })).toBe(2); // FULL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('enforces foreign keys', () => {
    db = openDatabase(':memory:');
    db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY); CREATE TABLE child (p TEXT REFERENCES parent(id));');
    expect(() => db!.exec("INSERT INTO child VALUES ('missing')")).toThrow(/FOREIGN KEY/);
  });

  it('closeDatabase is idempotent', () => {
    db = openDatabase(':memory:');
    closeDatabase(db);
    expect(() => closeDatabase(db!)).not.toThrow();
  });
});

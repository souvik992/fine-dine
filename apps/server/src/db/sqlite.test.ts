// NodeSqliteDatabase (DinePOS for Android) gives better-sqlite3's answers. The whole server suite also runs on it:
// DINEPOS_SQLITE=node npm run test -w @dinepos/server (CI does, on Linux).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Better from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSqliteDatabase } from './sqlite.js';

const both = () => [new Better(':memory:'), new NodeSqliteDatabase(':memory:') as unknown as Better.Database] as const;

describe('NodeSqliteDatabase answers like better-sqlite3', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('rows, pluck, run results, Buffers, named parameters (extra ones ignored)', () => {
    for (const db of both()) {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, data BLOB)');
      const r = db.prepare('INSERT INTO t (name, data) VALUES (?, ?)').run('naan', Buffer.from([1, 2, 3]));
      expect(r).toEqual({ changes: 1, lastInsertRowid: 1 });
      const row = db.prepare('SELECT * FROM t WHERE id = @id').get({ id: 1, unused: 'x' }) as { name: string; data: Buffer };
      expect(row.name).toBe('naan');
      expect(Buffer.isBuffer(row.data) && row.data.equals(Buffer.from([1, 2, 3]))).toBe(true);
      expect(db.prepare('SELECT name FROM t').pluck().all()).toEqual(['naan']);
      expect(db.prepare('SELECT name FROM t WHERE id = 9').pluck().get()).toBeUndefined();
      expect([...db.prepare('SELECT id FROM t').pluck().iterate()]).toEqual([1]);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1); // both turn foreign keys on by default
    }
  });

  it('transactions: commit, roll back on a throw, and a nested one is a savepoint', () => {
    for (const db of both()) {
      db.exec('CREATE TABLE t (n INTEGER)');
      const add = db.transaction((n: number) => db.prepare('INSERT INTO t VALUES (?)').run(n));
      add.immediate(1);
      expect(() =>
        db.transaction(() => {
          add(2);
          throw new Error('no');
        })(),
      ).toThrow('no');
      db.transaction(() => {
        add(3);
        try {
          db.transaction(() => {
            add(4);
            throw new Error('inner');
          })();
        } catch {
          // the inner one is undone, the outer one carries on
        }
      }).immediate();
      expect(db.prepare('SELECT n FROM t ORDER BY n').pluck().all()).toEqual([1, 3]);
      expect(db.inTransaction).toBe(false);
    }
  });

  it('knows which statements only read (add-ons may only read outside their commands)', () => {
    for (const db of both()) {
      db.exec('CREATE TABLE t (n INTEGER)');
      expect(db.prepare('SELECT n FROM t').readonly).toBe(true);
      expect(db.prepare('WITH x AS (SELECT 1) SELECT * FROM x').readonly).toBe(true);
      expect(db.prepare('INSERT INTO t VALUES (1)').readonly).toBe(false);
      expect(db.prepare('UPDATE t SET n = 2').readonly).toBe(false);
      expect(db.prepare('DELETE FROM t').readonly).toBe(false);
    }
  });

  it('online backup to a file, opened read-only afterwards', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dinepos-sqlite-'));
    dirs.push(dir);
    const db = new NodeSqliteDatabase(path.join(dir, 'live.db'));
    db.exec('CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (7)');
    await db.backup(path.join(dir, 'copy.db'));
    db.close();
    const copy = new NodeSqliteDatabase(path.join(dir, 'copy.db'), { readonly: true, fileMustExist: true });
    expect(copy.prepare('SELECT n FROM t').pluck().get()).toBe(7);
    expect(() => copy.exec('INSERT INTO t VALUES (8)')).toThrow();
    copy.close();
    expect(() => new NodeSqliteDatabase(path.join(dir, 'missing.db'), { fileMustExist: true })).toThrow(/unable to open/);
  });
});

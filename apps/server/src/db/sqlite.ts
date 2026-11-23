// The SQLite driver. Windows, Mac and Linux use better-sqlite3 (a compiled add-on). DinePOS for Android runs on Node's
// built-in node:sqlite instead (no compiled add-on exists for Android), through `NodeSqliteDatabase`: the part of
// better-sqlite3's API DinePOS uses, with the same results. DINEPOS_SQLITE=node picks it anywhere (the test suite runs
// on both); on Android it is the only one.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { backup as nodeBackup, DatabaseSync, type StatementSync } from 'node:sqlite';
import type BetterSqlite3 from 'better-sqlite3';

type Options = { readonly?: boolean; fileMustExist?: boolean };
type Row = Record<string, unknown>;

/** node:sqlite returns BLOBs as Uint8Array; DinePOS (like better-sqlite3) works with Buffers. */
const toBuffer = (v: unknown) => (v instanceof Uint8Array && !Buffer.isBuffer(v) ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : v);
function fixRow(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = toBuffer(v);
  return out;
}
/** better-sqlite3 binds one object as named parameters and Buffers as BLOBs; booleans are refused by both. */
const args = (params: unknown[]) => params.map((p) => (Buffer.isBuffer(p) ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : p)) as never[];

class NodeStatement {
  private plucked = false;
  private ro: boolean | null = null;
  constructor(
    private readonly st: StatementSync,
    private readonly db: NodeSqliteDatabase,
    readonly source: string,
  ) {
    // better-sqlite3 ignores named values a query does not use (reports pass one object for optional filters)
    st.setAllowUnknownNamedParameters(true);
  }

  pluck(on = true): this {
    this.plucked = on;
    return this;
  }
  private shape(row: unknown): unknown {
    if (row === undefined) return undefined;
    if (!this.plucked) return fixRow(row);
    const first = Object.values(row as Row)[0];
    return toBuffer(first);
  }
  run(...params: unknown[]) {
    const r = this.st.run(...args(params));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
  get(...params: unknown[]) {
    return this.shape(this.st.get(...args(params)));
  }
  all(...params: unknown[]) {
    return this.st.all(...args(params)).map((r) => this.shape(r));
  }
  *iterate(...params: unknown[]) {
    for (const r of this.st.iterate(...args(params))) yield this.shape(r);
  }
  /** Whether it only reads: SQLite's own plan opens no write transaction and no table for writing. */
  get readonly(): boolean {
    if (this.ro === null) this.ro = this.db.planReadsOnly(this.source);
    return this.ro;
  }
}

/** The part of better-sqlite3's Database that DinePOS uses, on node:sqlite. */
export class NodeSqliteDatabase {
  private readonly db: DatabaseSync;
  private depth = 0;
  private savepoint = 0;
  readonly name: string;
  readonly memory: boolean;
  readonly readonly: boolean;

  constructor(file: string, o: Options = {}) {
    if (o.fileMustExist && file !== ':memory:' && !existsSync(file)) throw new Error(`unable to open database file: ${file}`);
    this.db = new DatabaseSync(file, { readOnly: o.readonly === true });
    this.name = file;
    this.memory = file === ':memory:';
    this.readonly = o.readonly === true;
  }

  get open(): boolean {
    return this.db.isOpen;
  }
  get inTransaction(): boolean {
    return this.db.isTransaction;
  }

  prepare(sql: string): NodeStatement {
    return new NodeStatement(this.db.prepare(sql), this, sql);
  }
  exec(sql: string): this {
    this.db.exec(sql);
    return this;
  }
  /** `pragma('x = y')` → rows; `{ simple: true }` → the first column of the first row. */
  pragma(source: string, o: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all().map(fixRow) as Row[];
    return o.simple ? (rows[0] ? Object.values(rows[0])[0] : undefined) : rows;
  }

  /** Like better-sqlite3: a function that runs `fn` in a transaction (a savepoint inside another); `.immediate()` etc. */
  transaction<A extends unknown[], R>(fn: (...a: A) => R) {
    const make = (mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') => (...a: A): R => {
      if (this.depth > 0) {
        const sp = `dinepos_sp_${++this.savepoint}`;
        this.db.exec(`SAVEPOINT ${sp}`);
        this.depth++;
        try {
          const r = fn(...a);
          this.db.exec(`RELEASE ${sp}`);
          return r;
        } catch (e) {
          this.db.exec(`ROLLBACK TO ${sp}`);
          this.db.exec(`RELEASE ${sp}`);
          throw e;
        } finally {
          this.depth--;
        }
      }
      this.db.exec(`BEGIN ${mode}`);
      this.depth = 1;
      try {
        const r = fn(...a);
        this.db.exec('COMMIT');
        return r;
      } catch (e) {
        if (this.db.isTransaction) this.db.exec('ROLLBACK');
        throw e;
      } finally {
        this.depth = 0;
      }
    };
    return Object.assign(make('DEFERRED'), { deferred: make('DEFERRED'), immediate: make('IMMEDIATE'), exclusive: make('EXCLUSIVE') });
  }

  /** Online backup into `file` (better-sqlite3's `db.backup(file)`). */
  async backup(file: string): Promise<void> {
    await nodeBackup(this.db, file);
  }

  close(): this {
    if (this.db.isOpen) this.db.close();
    return this;
  }

  /** Used by NodeStatement.readonly. */
  planReadsOnly(sql: string): boolean {
    const plan = this.db.prepare(`EXPLAIN ${sql}`).all() as Array<{ opcode: string; p2: number }>;
    return !plan.some((op) => op.opcode === 'OpenWrite' || (op.opcode === 'Transaction' && Number(op.p2) !== 0));
  }
}

const useNode = process.env.DINEPOS_SQLITE === 'node' || process.platform === 'android';

/**
 * Opens a database with the driver for this platform. Typed as better-sqlite3's Database: NodeSqliteDatabase gives
 * the same answers for every method DinePOS calls (src/db/sqlite.test.ts runs the server's tests on both).
 */
export function openSqlite(file: string, o: Options = {}): BetterSqlite3.Database {
  if (useNode) return new NodeSqliteDatabase(file, o) as unknown as BetterSqlite3.Database;
  // loaded only here, so the Android bundle (which has no better-sqlite3) never asks for it
  const Better = createRequire(import.meta.url)('better-sqlite3') as typeof BetterSqlite3;
  return new Better(file, o);
}

export const SQLITE_DRIVER: 'node:sqlite' | 'better-sqlite3' = useNode ? 'node:sqlite' : 'better-sqlite3';

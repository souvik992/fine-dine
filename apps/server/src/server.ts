import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp, LOG_REDACT } from './app.js';
import type { ServerConfig } from './config.js';
import { ensureBusinessDay } from './core/business-day.js';
import { closeDatabase, openDatabase, type Db } from './db/connection.js';
import { acquireDataDirLock, type DataDirLock } from './db/lock.js';
import { migrate, type MigrationResult } from './db/migrate.js';

export interface RunningServer {
  app: FastifyInstance;
  db: Db;
  config: ServerConfig;
  dbPath: string;
  migrations: MigrationResult;
  businessDate: string;
  /** Base URL actually bound (port 0 resolves to a free port). */
  url: string;
  close(): Promise<void>;
}

export interface StartOptions {
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
}

/** Startup order: data dir → lock → open DB → migrate → open business day → listen. */
export async function startServer(config: ServerConfig, opts: StartOptions = {}): Promise<RunningServer> {
  const now = opts.now ?? (() => new Date());
  for (const sub of ['', 'backups', 'logs']) mkdirSync(path.join(config.dataDir, sub), { recursive: true });

  const lock = acquireDataDirLock(config.dataDir, now);
  let db: Db | undefined;
  try {
    const dbPath = path.join(config.dataDir, config.dbFile);
    db = openDatabase(dbPath);
    const migrations = migrate(db, undefined, now);
    const businessDate = ensureBusinessDay(db, config.timeZone, now);

    const logger = opts.logger ?? { level: config.logLevel, redact: LOG_REDACT };
    const app = buildApp({ db, timeZone: config.timeZone, now, startedAt: now(), logger });
    app.log.warn(
      'Auth mode "single-terminal": every request acts as the local terminal. Use only on a trusted LAN until device pairing (P2-02).',
    );
    const url = await app.listen({ host: config.host, port: config.port });
    app.log.info(
      { dbPath, schemaVersion: migrations.schemaVersion, appliedNow: migrations.applied, businessDate },
      'DinePOS server ready',
    );

    const openDb = db;
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= (async () => {
        try {
          await app.close();
        } finally {
          closeDatabase(openDb);
          lock.release();
        }
      })());

    return { app, db, config, dbPath, migrations, businessDate, url, close };
  } catch (err) {
    cleanup(db, lock);
    throw err;
  }
}

function cleanup(db: Db | undefined, lock: DataDirLock): void {
  try {
    if (db) closeDatabase(db);
  } finally {
    lock.release();
  }
}

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FakeTransport, TcpTransport, WindowsSpoolerTransport } from '@dinepos/printing';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp, LOG_REDACT } from './app.js';
import type { ServerConfig } from './config.js';
import { ensureBusinessDay } from './core/business-day.js';
import { EventBus } from './core/events.js';
import { closeDatabase, openDatabase, type Db } from './db/connection.js';
import { acquireDataDirLock, type DataDirLock } from './db/lock.js';
import { migrate, type MigrationResult } from './db/migrate.js';
import { PrintQueue, type PrintQueueOptions } from './print/print-queue.js';

export interface RunningServer {
  app: FastifyInstance;
  db: Db;
  config: ServerConfig;
  dbPath: string;
  migrations: MigrationResult;
  businessDate: string;
  bus: EventBus;
  printQueue: PrintQueue;
  /** Base URL actually bound (port 0 resolves to a free port). */
  url: string;
  close(): Promise<void>;
}

export interface StartOptions {
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
  /** Override printer transports (tests). Defaults: fake → data/prints, tcp, Windows spooler. */
  transports?: PrintQueueOptions['transports'];
  printBackoffMs?: number[];
}

/** Startup order: data dir → lock → open DB → migrate → open business day → listen → resume print queue. */
export async function startServer(config: ServerConfig, opts: StartOptions = {}): Promise<RunningServer> {
  const now = opts.now ?? (() => new Date());
  for (const sub of ['', 'backups', 'logs', 'prints']) mkdirSync(path.join(config.dataDir, sub), { recursive: true });

  const lock = acquireDataDirLock(config.dataDir, now);
  let db: Db | undefined;
  try {
    const dbPath = path.join(config.dataDir, config.dbFile);
    db = openDatabase(dbPath);
    const migrations = migrate(db, undefined, now);
    const businessDate = ensureBusinessDay(db, config.timeZone, now);

    const logger = opts.logger ?? { level: config.logLevel, redact: LOG_REDACT };
    const bus = new EventBus();
    // The queue is built before the app (the app wakes it), so its logger is attached once the app exists.
    const logSink: { log?: PrintQueueOptions['log'] } = {};
    const printQueue = new PrintQueue({
      db,
      bus,
      timeZone: config.timeZone,
      now,
      backoffMs: opts.printBackoffMs,
      transports: opts.transports ?? {
        fake: new FakeTransport(path.join(config.dataDir, 'prints')),
        tcp: new TcpTransport(),
        usb: new WindowsSpoolerTransport(),
      },
      log: (level, msg, data) => logSink.log?.(level, msg, data),
    });
    const app = buildApp({ db, timeZone: config.timeZone, now, startedAt: now(), logger, bus, printWaker: printQueue, printQueue });
    logSink.log = (level, msg, data) => app.log[level](data ?? {}, msg);
    app.log.warn(
      'Auth mode "single-terminal": every request acts as the local terminal. Use only on a trusted LAN until device pairing (P2-02).',
    );
    const url = await app.listen({ host: config.host, port: config.port });
    printQueue.start();
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
          await printQueue.stop();
        } finally {
          closeDatabase(openDb);
          lock.release();
        }
      })());

    return { app, db, config, dbPath, migrations, businessDate, bus, printQueue, url, close };
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

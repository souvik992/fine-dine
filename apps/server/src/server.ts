import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FakeTransport, TcpTransport, WindowsSpoolerTransport } from '@dinepos/printing';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { localDate } from '@dinepos/shared';
import { buildApp, LOG_REDACT } from './app.js';
import { formatBanner, lanAddresses } from './banner.js';
import type { ServerConfig } from './config.js';
import { ensureBusinessDay } from './core/business-day.js';
import { EventBus } from './core/events.js';
import { closeDatabase, openDatabase, type Db } from './db/connection.js';
import { acquireDataDirLock, type DataDirLock } from './db/lock.js';
import { migrate, type MigrationResult } from './db/migrate.js';
import { PrintQueue, type PrintQueueOptions } from './print/print-queue.js';
import { SERVER_VERSION } from './version.js';

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
  /** Where JSON logs go when config.logToFile is on. */
  logFile: string | null;
  close(): Promise<void>;
}

export interface StartOptions {
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
  /** Override printer transports (tests). Defaults: fake → data/prints, tcp, Windows spooler. */
  transports?: PrintQueueOptions['transports'];
  printBackoffMs?: number[];
  /** Print the start-up banner (addresses, data folder) to the console: the server window. */
  banner?: boolean;
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

    const logFile = config.logToFile ? path.join(config.dataDir, 'logs', `server-${localDate(now(), config.timeZone)}.log`) : null;
    const logger = opts.logger ?? {
      level: config.logLevel,
      redact: LOG_REDACT,
      ...(logFile ? { stream: createWriteStream(logFile, { flags: 'a' }) } : {}),
    };
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
    const app = buildApp({
      db,
      timeZone: config.timeZone,
      now,
      startedAt: now(),
      logger,
      bus,
      printWaker: printQueue,
      printQueue,
      allowedOrigins: config.allowedOrigins,
    });
    logSink.log = (level, msg, data) => app.log[level](data ?? {}, msg);
    const url = await app.listen({ host: config.host, port: config.port });
    printQueue.start();
    if (opts.banner) {
      const port = Number(new URL(url).port) || config.port;
      process.stdout.write(formatBanner({ version: SERVER_VERSION, host: config.host, port, dataDir: config.dataDir, businessDate, logFile, lan: lanAddresses() }));
    }
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

    return { app, db, config, dbPath, migrations, businessDate, bus, printQueue, url, logFile, close };
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

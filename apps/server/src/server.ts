import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { FakeTransport, TcpTransport, WindowsSpoolerTransport } from '@dinepos/printing';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { localDate } from '@dinepos/shared';
import { buildApp, LOG_REDACT } from './app.js';
import { formatBanner, lanAddresses } from './banner.js';
import type { ServerConfig } from './config.js';
import { ensureBusinessDay } from './core/business-day.js';
import { licenceGateFor } from './licence/from-env.js';
import type { LicenceGate } from './licence/gate.js';
import { EventBus } from './core/events.js';
import { closeDatabase, openDatabase, type Db } from './db/connection.js';
import { acquireDataDirLock, type DataDirLock } from './db/lock.js';
import { migrate, type MigrationResult } from './db/migrate.js';
import { PrintQueue, type PrintQueueOptions } from './print/print-queue.js';
import { applyPendingRestore } from './backup/backups.js';
import { BackupScheduler } from './backup/scheduler.js';
import { getConfig } from './core/outlet-config.js';
import { SERVER_VERSION } from './version.js';
import { loadAddons } from './addons/loader.js';
import { coreHandlers } from './commands/registry.js';
import { hostname } from 'node:os';
import { localNameUrl } from '@dinepos/shared';
import { ensureServerId } from './core/server-id.js';
import { startDiscoveryResponder, type DiscoveryResponder } from './discovery/responder.js';

export interface RunningServer {
  app: FastifyInstance;
  db: Db;
  config: ServerConfig;
  dbPath: string;
  migrations: MigrationResult;
  /** Null when no day is open (P2-09: the licence does not allow a new one). */
  businessDate: string | null;
  bus: EventBus;
  printQueue: PrintQueue;
  /** Base URL actually bound (port 0 resolves to a free port). */
  url: string;
  /** Where JSON logs go when config.logToFile is on. */
  logFile: string | null;
  backups: BackupScheduler;
  /** Set when this start applied a staged restore. */
  restored: { restored: string; aside: string } | null;
  close(): Promise<void>;
}

export interface StartOptions {
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
  /** Override printer transports (tests). Defaults: fake → data/prints, tcp, Windows spooler. */
  transports?: PrintQueueOptions['transports'];
  printBackoffMs?: number[];
  /** P5-01: where add-ons are installed (default <dataDir>/addons, or DINEPOS_ADDONS_DIR) and the keys trusted (tests). */
  addonsDir?: string;
  addonTrustKeys?: Readonly<Record<string, string>>;
  /** Print the start-up banner (addresses, data folder) to the console: the server window. */
  banner?: boolean;
  /** Called when a restore was staged: the caller stops this server and starts it again (index.ts). */
  requestRestart?: () => void;
  /** Backup interval; tests use a long one. */
  backupIntervalMs?: number;
  /** P2-09: the licence check (default: licenceGateFor(), enforced in the installed server). */
  licence?: LicenceGate;
  /**
   * P2-15: answer discovery probes on this UDP port (the server's own port number in production, index.ts) so
   * kitchen screens find the server after its IP changes. Off when absent (tests).
   */
  discoveryPort?: number;
}

/** Startup order: data dir → lock → open DB → migrate → open business day → listen → resume print queue. */
export async function startServer(config: ServerConfig, opts: StartOptions = {}): Promise<RunningServer> {
  const now = opts.now ?? (() => new Date());
  for (const sub of ['', 'backups', 'logs', 'prints']) mkdirSync(path.join(config.dataDir, sub), { recursive: true });

  const lock = acquireDataDirLock(config.dataDir, now);
  let db: Db | undefined;
  try {
    const dbPath = path.join(config.dataDir, config.dbFile);
    // A restore staged in Settings › Backups replaces the database before it is opened (P2-08).
    const restored = applyPendingRestore(config.dataDir, config.dbFile, now());
    db = openDatabase(dbPath);
    const migrations = migrate(db, undefined, now);
    const serverId = ensureServerId(db); // P2-15: before anyone can ask
    // P2-09: a new business date opens only with a valid licence (a date already open carries on).
    const licence = opts.licence ?? licenceGateFor();
    const openedForLicence = db;
    const businessDate = ensureBusinessDay(db, config.timeZone, now, () => licence.status(openedForLicence, now()).canOpenDay);

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
    const openedDb = db;
    const backups = new BackupScheduler({
      db,
      dataDir: config.dataDir,
      now,
      bus,
      copyDir: () => getConfig(openedDb)['backup.copyDir'],
      intervalMs: opts.backupIntervalMs,
      log: (level, msg, data) => logSink.log?.(level, msg, data),
    });
    // P5-01: signed add-ons, checked before any of their code runs; a failing one is switched off, DinePOS starts anyway
    const addons = loadAddons({
      db,
      dir: opts.addonsDir ?? process.env.DINEPOS_ADDONS_DIR ?? path.join(config.dataDir, 'addons'),
      dataDir: config.dataDir,
      posVersion: SERVER_VERSION,
      timeZone: config.timeZone,
      now,
      reservedTypes: new Set(coreHandlers.map((h) => h.type)),
      ...(opts.addonTrustKeys ? { trustKeys: opts.addonTrustKeys } : {}),
    });
    const app = buildApp({
      addons,
      port: config.port,
      db,
      timeZone: config.timeZone,
      now,
      startedAt: now(),
      logger,
      bus,
      printWaker: printQueue,
      printQueue,
      allowedOrigins: config.allowedOrigins,
      trustLoopback: config.trustLoopback ?? true,
      backups: { scheduler: backups, dataDir: config.dataDir, requestRestart: opts.requestRestart ?? (() => undefined) },
      licence,
    });
    logSink.log = (level, msg, data) => app.log[level](data ?? {}, msg);
    for (const a of addons.infos()) {
      if (a.status === 'on') app.log.info({ addon: a.id, version: a.version }, 'add-on loaded');
      else app.log.warn({ addon: a.id, reason: a.error }, 'add-on switched off');
    }
    const url = await app.listen({ host: config.host, port: config.port });
    const tcpPort = Number(new URL(url).port) || config.port;
    let discovery: DiscoveryResponder | null = null;
    if (opts.discoveryPort !== undefined) {
      const outletDb = db;
      discovery = await startDiscoveryResponder(
        { serverId, name: () => getConfig(outletDb)['outlet.name'], host: hostname().toLowerCase(), port: tcpPort },
        // on the same addresses as HTTP (a server for this PC only answers this PC only)
        { port: opts.discoveryPort, host: config.host === '::' ? '0.0.0.0' : config.host, log: (level, msg, data) => app.log[level](data ?? {}, msg) },
      );
    }
    printQueue.start();
    printQueue.startMonitor(); // printer status between tickets: a printer switched off shows red without a failed print
    backups.start();
    app.online.start(); // P4-06: idle unless online orders are on and the outlet is paired with a hub
    app.sync.start(); // P4-05: sends the outbox to the same hub; idle unless paired
    if (restored) app.log.warn(restored, 'restored a backup; the previous database was kept aside');
    if (!businessDate) app.log.warn({ licence: licence.status(db, now()).state }, 'no business day open: the licence does not allow a new one');
    if (opts.banner) {
      process.stdout.write(
        formatBanner({ version: SERVER_VERSION, host: config.host, port: tcpPort, dataDir: config.dataDir, businessDate, logFile, lan: lanAddresses(), nameUrl: localNameUrl(hostname(), tcpPort) }),
      );
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
          await discovery?.close();
          await app.close();
          await printQueue.stop();
          await backups.stop();
        } finally {
          closeDatabase(openDb);
          lock.release();
        }
      })());

    return { app, db, config, dbPath, migrations, businessDate, bus, printQueue, url, logFile, backups, restored, close };
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

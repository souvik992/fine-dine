import { newId } from '@dinepos/shared';
import { OnlineConnector, SYSTEM_ACTOR, type Execute } from './online/connector.js';
import { onlineRoutes } from './routes/online.js';
import { syncRoutes } from './routes/sync.js';
import { SyncAgent } from './sync/sync-agent.js';
import { executeCommand, type ExecuteDeps } from './core/execute-command.js';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ulid } from 'ulid';
import { sessionAuth, type Authenticator } from './auth/authenticate.js';
import { commandRegistry } from './commands/registry.js';
import { DEFAULT_ALLOWED_ORIGINS } from './config.js';
import type { CommandRegistry } from './core/command-handler.js';
import type { DeviceKind } from './core/context.js';
import { unenforcedGate, type LicenceGate } from './licence/gate.js';
import { PosError } from './core/errors.js';
import { EventBus, noopPrintWaker, type PrintWaker } from './core/events.js';
import { roleRights, type RightsPolicy } from './core/rights.js';
import type { Db } from './db/connection.js';
import type { PrinterStatus } from './print/print-queue.js';
import { RealtimeHub, type HubOptions } from './realtime/hub.js';
import { commandRoutes } from './routes/commands.js';
import { healthRoutes } from './routes/health.js';
import { licenceRoutes } from './routes/licence.js';
import { queryRoutes } from './routes/queries.js';
import { sessionRoutes } from './routes/sessions.js';
import { stockRoutes } from './routes/stock.js';
import { cashierRoutes } from './routes/cashier.js';
import { deviceRoutes } from './routes/devices.js';
import { reportRoutes } from './routes/reports.js';
import { defaultWebDir, webAppRoutes } from './routes/web-apps.js';
import { deviceTokenOf, deviceUnpaired, isLoopback, MASTER_DEVICE_ID, resolveDevice, touchDevice } from './auth/devices.js';
import { backupRoutes } from './routes/backups.js';
import type { BackupScheduler } from './backup/scheduler.js';
import { isAllowedOrigin, streamRoutes } from './routes/stream.js';

export interface AppDeps {
  db: Db;
  timeZone: string;
  now?: () => Date;
  startedAt?: Date;
  logger?: FastifyServerOptions['logger'];
  registry?: CommandRegistry;
  rights?: RightsPolicy;
  auth?: Authenticator;
  bus?: EventBus;
  printWaker?: PrintWaker;
  /** Live printer status for GET /v1/printers. */
  printQueue?: { status(printerId: string): PrinterStatus | undefined; error?(printerId: string): string | undefined };
  /** Browser origins allowed for CORS and the stream. */
  allowedOrigins?: readonly string[];
  hub?: HubOptions;
  /**
   * Device tokens (P2-02): 'required' (default) refuses requests from unpaired devices; 'off' for tools and tests
   * that predate pairing. The master PC (loopback) is trusted unless `trustLoopback` is false (tests).
   */
  devices?: 'required' | 'off';
  /** Built captain app folder (P3-01); defaults to the repo build or the bundle's web/captain. */
  captainDir?: string;
  /** Built kitchen display app folder (P4-02); defaults like captainDir. */
  kdsDir?: string;
  trustLoopback?: boolean;
  /** Backups and restore (P2-08); absent in tests that do not need them. */
  backups?: { scheduler: BackupScheduler; dataDir: string; requestRestart: () => void };
  /** P2-09: the licence check (default: not enforced, as in tests). */
  licence?: LicenceGate;
  /** P4-06 / P4-05: how the connector and the sync agent reach the order hub (tests pass a fake). */
  onlineFetch?: typeof fetch;
}

// Secrets never reach the log (docs/07-security-licensing.md).
export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers["x-user-session"]',
  'req.headers["x-manager-pin"]',
];

export type DinePosApp = FastifyInstance & { realtime: RealtimeHub; online: OnlineConnector; sync: SyncAgent };

/** Builds the HTTP app without listening, so tests can use `app.inject()`. */
export function buildApp(deps: AppDeps): DinePosApp {
  const { db, timeZone, now = () => new Date(), logger = false } = deps;
  const startedAt = deps.startedAt ?? now();
  const allowedOrigins = deps.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const bus = deps.bus ?? new EventBus();
  const app = Fastify({
    logger,
    bodyLimit: 1024 * 1024,
    genReqId: () => ulid(),
    requestIdHeader: false,
  });

  app.addHook('onSend', async (req, reply) => {
    void reply.header('x-request-id', req.id);
  });

  // Every request names its device (P2-02): a paired device's token, or the master PC itself (loopback).
  const trustLoopback = deps.trustLoopback ?? true;
  app.decorateRequest('deviceId', null);
  app.decorateRequest('deviceKind', null);
  if (deps.devices !== 'off') {
    app.addHook('onRequest', (req, _reply, done) => {
      const url = req.url.split('?')[0]!;
      // Public: health, pairing itself, CORS preflight; the stream checks its hello instead.
      if (req.method === 'OPTIONS' || url === '/v1/health' || url === '/v1/stream' || url.startsWith('/v1/pairing-requests')) return done();
      // The apps' files; their API calls carry a token.
      if (url === '/captain' || url.startsWith('/captain/') || url === '/kds' || url.startsWith('/kds/')) return done();
      if (trustLoopback && isLoopback(req.ip)) {
        req.deviceId = MASTER_DEVICE_ID;
        req.deviceKind = 'master';
        return done();
      }
      const device = resolveDevice(db, deviceTokenOf(req.headers.authorization));
      if (!device) return done(deviceUnpaired());
      req.deviceId = device.id;
      req.deviceKind = device.kind;
      touchDevice(db, device.id, now());
      done();
    });
  }

  void app.register(fastifyCors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin, undefined, allowedOrigins)),
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type', 'authorization', 'x-user-session', 'x-manager-pin'],
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });
  void app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof PosError) {
      if (err.httpStatus >= 500) req.log.error({ err }, 'command failed');
      return reply
        .status(err.httpStatus)
        .send({ ...errorBody(err.code, err.message, err.details), ...(err.order ? { order: err.order } : {}) });
    }
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation) {
      return reply.status(400).send(errorBody('VALIDATION', e.message ?? 'Invalid request.', e.validation));
    }
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      // Fastify's own client errors (bad JSON, body too large, wrong content type).
      return reply.status(e.statusCode).send(errorBody('VALIDATION', e.message ?? 'Bad request.'));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(errorBody('INTERNAL', 'Something went wrong on the server. Please try again.'));
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send(errorBody('NOT_FOUND', `No route for ${req.method} ${req.url.split('?')[0]}.`)),
  );

  const hub = new RealtimeHub(db, bus, {
    now,
    authorizeDevice:
      deps.devices === 'off'
        ? () => MASTER_DEVICE_ID
        : (token, ip) => (trustLoopback && isLoopback(ip) ? MASTER_DEVICE_ID : (resolveDevice(db, token ?? undefined)?.id ?? null)),
    ...deps.hub,
  });
  app.addHook('preClose', (done) => {
    hub.closeAll();
    done();
  });

  const licenceGate = deps.licence ?? unenforcedGate();
  healthRoutes(app, { db, timeZone, now, startedAt, backupStatus: deps.backups ? () => deps.backups!.scheduler.status() : undefined, licence: () => licenceGate.status(db, now()) });
  licenceRoutes(app, { db, now, licence: licenceGate });
  queryRoutes(app, { db, timeZone, now, printerStatus: deps.printQueue ? (id) => deps.printQueue!.status(id) : undefined, printerError: deps.printQueue ? (id) => deps.printQueue!.error?.(id) : undefined });
  const executeDeps: ExecuteDeps = {
      db,
      timeZone,
      now,
      registry: deps.registry ?? commandRegistry,
      rights: deps.rights ?? roleRights,
      bus,
      printWaker: deps.printWaker ?? noopPrintWaker,
      licence: licenceGate,
      onPostCommitError: (err, stage) => app.log.error({ err, stage }, 'post-commit step failed'),
    };
  commandRoutes(app, executeDeps, deps.auth ?? sessionAuth(db, now));

  // P4-06: online orders through the order hub. Started by the server (server.ts); idle unless switched on and paired.
  const execute: Execute = (type, payload, actor = SYSTEM_ACTOR) =>
    executeCommand(executeDeps, { commandId: newId(), type, payload, createdAt: now().toISOString() }, actor);
  const online = new OnlineConnector({ db, now, execute, bus, ...(deps.onlineFetch ? { fetch: deps.onlineFetch } : {}), log: { info: (m, d) => app.log.info(d ?? {}, m), warn: (m, d) => app.log.warn(d ?? {}, m) } });
  // P4-05: the outbox sent up to the same hub, licence renewals fetched down. Started by the server; idle unless paired.
  const sync = new SyncAgent({ db, now, execute, bus, ...(deps.onlineFetch ? { fetch: deps.onlineFetch } : {}), log: { info: (m, d) => app.log.info(d ?? {}, m), warn: (m, d) => app.log.warn(d ?? {}, m) } });
  app.addHook('onClose', async () => {
    await online.stop();
    await sync.stop();
  });
  onlineRoutes(app, { db, now, connector: online, execute, ...(deps.onlineFetch ? { fetch: deps.onlineFetch } : {}) });
  syncRoutes(app, { db, now, agent: sync });
  sessionRoutes(app, { db, now, timeZone });
  stockRoutes(app, { db, now });
  cashierRoutes(app, { db, now });
  deviceRoutes(app, { db, now });
  reportRoutes(app, { db, now, timeZone });
  webAppRoutes(app, 'captain', deps.captainDir ?? defaultWebDir('captain'));
  webAppRoutes(app, 'kds', deps.kdsDir ?? defaultWebDir('kds'));
  if (deps.backups) backupRoutes(app, { db, now, timeZone, dataDir: deps.backups.dataDir, backups: deps.backups.scheduler, requestRestart: deps.backups.requestRestart });
  streamRoutes(app, hub, allowedOrigins);
  return Object.assign(app, { realtime: hub, online, sync });
}

function errorBody(code: string, message: string, details?: unknown) {
  return { ok: false as const, error: { code, message, ...(details === undefined ? {} : { details }) } };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the device check (P2-02); null when devices are off. */
    deviceId: string | null;
    /** The paired device's kind, or `master` for the master PC itself (P4-02: device rights). */
    deviceKind: DeviceKind | null;
  }
}

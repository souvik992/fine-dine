// Loads the signed add-ons (P5-01, docs/adr/0004-signed-addons.md). For each folder in the add-ons directory:
// check the package (signature, folder = id, POS version, fingerprints) → refuse a version older than one already
// run → run backend.cjs from the checked bytes with `register(host)` → apply its database steps (own tables only).
// Any failure switches that add-on off with a reason; DinePOS itself always starts.
import { builtinModules, createRequire } from 'node:module';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  ADDON_TRUST_KEYS,
  compareVersions,
  isRight,
  type AddonInfo,
  type AddonManifest,
  type CommandSuccess,
  type Right,
  type TableBadge,
} from '@dinepos/shared';
import type { CommandHandler, OrderRow, HandlerResult } from '../core/command-handler.js';
import type { Actor, CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';
import { checkPackage, sha256 } from './package.js';
import { sqlProblem } from './sql-guard.js';

export type AddonAccess = 'staff' | 'guest';

/** What an add-on route handler receives. `actor` is the signed-in staff member (staff routes) or null (guest). */
export interface AddonRequest {
  actor: Actor | null;
  body: unknown;
  query: Record<string, string>;
  params: Record<string, string>;
  ip: string;
}

export interface AddonRoute {
  method: 'GET' | 'POST';
  /** Below `/v1/addons/<id>` (staff) or `/a/<id>/api` (guest), e.g. `/orders/:id/accept`. */
  path: string;
  access: AddonAccess;
  right: Right | null;
  handler: (req: AddonRequest) => unknown;
}

/** A route's answer that is a file (e.g. a dish photo for the guest menu), made with host.file(). Images only. */
export class AddonFile {
  constructor(
    readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp',
    readonly bytes: Uint8Array,
  ) {}
}

export interface AddonStatic {
  /** Package file served. */
  file: string;
  type: string;
}

export interface AddonCommandDef {
  type: string;
  schema: { safeParse(v: unknown): unknown };
  right: Right | null;
  needsOrder?: boolean;
  allowWhenDayClosed?: boolean;
  /** Only the add-on's own server code may run it (host.execute), never a client through /v1/commands. */
  internal?: boolean;
  apply(ctx: CommandContext, payload: unknown, order: OrderRow | null): HandlerResult | void;
}

export type BadgeSource = (db: AddonDb) => Array<{ tableId: string; key: string; label: string; tone: TableBadge['tone'] }>;

/** Read-only database access outside commands (writes happen only inside the add-on's commands). */
export interface AddonDb {
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
}

export interface ExecuteOptions {
  actor: Actor;
  commandId?: string;
  orderId?: string;
  expectedVersion?: number;
}

/** Filled in once the app exists (the add-ons register before it). */
export interface AddonRuntime {
  execute(body: { commandId: string; type: string; payload: unknown; orderId?: string; expectedVersion?: number; createdAt: string }, actor: Actor): CommandSuccess;
  floor(): unknown;
  menu(): unknown;
  order(orderId: string): unknown;
  config(): unknown;
  network(): { addresses: string[]; port: number };
  newId(): string;
}

export interface LoadedAddon {
  manifest: AddonManifest;
  files: ReadonlyMap<string, Buffer>;
  status: 'on' | 'off';
  error: string | null;
  commands: CommandHandler<unknown, unknown>[];
  routes: AddonRoute[];
  statics: Map<string, AddonStatic>;
  badges: BadgeSource[];
  stops: Array<() => unknown>;
}

export interface LoadOptions {
  db: Db;
  dir: string;
  dataDir: string;
  posVersion: string;
  timeZone: string;
  now: () => Date;
  trustKeys?: Readonly<Record<string, string>>;
  /** DinePOS's own command names (an add-on may not take one). */
  reservedTypes?: ReadonlySet<string>;
  log?: { info(msg: string, data?: unknown): void; warn(msg: string, data?: unknown): void; error(msg: string, data?: unknown): void };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const ROUTE_PATH = /^(\/[a-z0-9-]+|\/:[a-zA-Z]+)+$/;
const COMMAND_TYPE = /^[A-Z][A-Za-z0-9]{1,63}$/;

export class AddonSet {
  private runtime: AddonRuntime | null = null;

  constructor(
    readonly addons: LoadedAddon[],
    private readonly db: Db,
  ) {}

  get active(): LoadedAddon[] {
    return this.addons.filter((a) => a.status === 'on');
  }

  infos(): AddonInfo[] {
    return this.addons.map((a) => ({
      id: a.manifest.id,
      name: a.manifest.name,
      version: a.manifest.version,
      description: a.manifest.description ?? null,
      status: a.status,
      error: a.error,
      ui:
        a.status === 'on' && a.manifest.files['ui/ui.js']
          ? { script: a.manifest.files['ui/ui.js'], style: a.manifest.files['ui/ui.css'] ?? null }
          : null,
    }));
  }

  commands(): CommandHandler<unknown, unknown>[] {
    return this.active.flatMap((a) => a.commands);
  }

  /** Rights an add-on's own actor may use (its signed manifest). */
  rightsOf(addonId: string): readonly Right[] {
    return this.active.find((a) => a.manifest.id === addonId)?.manifest.rights ?? [];
  }

  /** The add-ons' marks for the floor, per table. A failing source is skipped (the floor always loads). */
  badges(): Map<string, TableBadge[]> {
    const out = new Map<string, TableBadge[]>();
    for (const a of this.active) {
      for (const source of a.badges) {
        try {
          for (const b of source(readOnly(this.db))) {
            out.set(b.tableId, [...(out.get(b.tableId) ?? []), { addonId: a.manifest.id, key: String(b.key), label: String(b.label).slice(0, 40), tone: b.tone }]);
          }
        } catch {
          // a broken badge source never stops the floor
        }
      }
    }
    return out;
  }

  bind(runtime: AddonRuntime): void {
    this.runtime = runtime;
  }

  rt(): AddonRuntime {
    if (!this.runtime) throw new Error('DinePOS is still starting.');
    return this.runtime;
  }

  async stop(): Promise<void> {
    for (const a of this.active) for (const s of a.stops) await Promise.resolve().then(s).catch(() => undefined);
  }
}

/** Reads add-on state rows and the anti-rollback version (migration 0015). */
function stateOf(db: Db, id: string): { highest_version: string } | undefined {
  return db.prepare('SELECT highest_version FROM addon_state WHERE id = ?').get(id) as { highest_version: string } | undefined;
}

function saveState(db: Db, a: LoadedAddon, now: Date): void {
  const prev = stateOf(db, a.manifest.id);
  const highest = a.status === 'on' && (!prev || compareVersions(a.manifest.version, prev.highest_version) > 0) ? a.manifest.version : (prev?.highest_version ?? '0.0.0');
  db.prepare(
    `INSERT INTO addon_state (id, version, highest_version, status, error, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, highest_version = excluded.highest_version, status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`,
  ).run(a.manifest.id, a.manifest.version, highest, a.status, a.error, now.toISOString());
}

export function loadAddons(o: LoadOptions): AddonSet {
  const loaded: LoadedAddon[] = [];
  const set = new AddonSet(loaded, o.db);
  let folders: string[];
  try {
    folders = readdirSync(o.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return set; // no add-ons folder: none installed
  }
  for (const folder of folders) {
    const dir = path.join(o.dir, folder);
    let a: LoadedAddon | null = null;
    try {
      const pkg = checkPackage(dir, o.posVersion, o.trustKeys ?? ADDON_TRUST_KEYS);
      a = { manifest: pkg.manifest, files: pkg.files, status: 'off', error: null, commands: [], routes: [], statics: new Map(), badges: [], stops: [] };
      const prev = stateOf(o.db, pkg.manifest.id);
      if (prev && compareVersions(pkg.manifest.version, prev.highest_version) < 0) {
        throw new Error(`Version ${pkg.manifest.version} is older than ${prev.highest_version}, which already ran here. Install ${prev.highest_version} or newer.`);
      }
      const steps = register(a, set, o);
      applySteps(o.db, a.manifest.id, steps, o.now());
      a.status = 'on';
      o.log?.info('add-on loaded', { addon: a.manifest.id, version: a.manifest.version });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (!a) {
        // not even a readable, trusted package: listed under its folder name
        a = {
          manifest: { id: folder, name: folder, version: '0.0.0', minPosVersion: '0.0.0', commandPrefix: 'X', keyId: '', files: {}, signature: '' },
          files: new Map(),
          status: 'off',
          error: reason,
          commands: [],
          routes: [],
          statics: new Map(),
          badges: [],
          stops: [],
        };
      } else {
        a.status = 'off';
        a.error = reason;
        a.commands = [];
        a.routes = [];
      }
      o.log?.warn('add-on switched off', { addon: folder, reason });
    }
    loaded.push(a);
    if (a.manifest.keyId) saveState(o.db, a, o.now());
  }
  return set;
}

/** Runs backend.cjs (checked bytes) and collects what it registers; returns its database steps. */
function register(a: LoadedAddon, set: AddonSet, o: LoadOptions): string[] {
  const m = a.manifest;
  const steps: string[] = [];
  const dataDir = path.join(o.dataDir, 'addons-data', m.id);
  const nodeRequire = createRequire(import.meta.url);
  const safeRequire = (name: string) => {
    const bare = name.startsWith('node:') ? name.slice(5) : name;
    if (!builtinModules.includes(bare)) throw new Error(`An add-on may use Node built-in modules only (it asked for "${name}").`);
    return nodeRequire(`node:${bare}`) as unknown;
  };
  const execute = (type: string, payload: unknown, opts: ExecuteOptions): CommandSuccess =>
    set.rt().execute(
      {
        commandId: opts.commandId ?? set.rt().newId(),
        type,
        payload,
        ...(opts.orderId !== undefined ? { orderId: opts.orderId, expectedVersion: opts.expectedVersion ?? currentVersion(o.db, opts.orderId) } : {}),
        createdAt: o.now().toISOString(),
      },
      opts.actor,
    );
  const host = {
    id: m.id,
    version: m.version,
    posVersion: o.posVersion,
    timeZone: o.timeZone,
    dataDir,
    now: () => o.now(),
    log: {
      info: (msg: string, data?: unknown) => o.log?.info(`[${m.id}] ${msg}`, data),
      warn: (msg: string, data?: unknown) => o.log?.warn(`[${m.id}] ${msg}`, data),
      error: (msg: string, data?: unknown) => o.log?.error(`[${m.id}] ${msg}`, data),
    },
    PosError,
    db: readOnly(o.db),
    /** Database steps, in order; each runs once (own `<id>_` tables only). Never edit a step that has shipped. */
    migrations(list: string[]) {
      if (!Array.isArray(list) || list.some((s) => typeof s !== 'string')) throw new Error('migrations() takes a list of SQL texts.');
      steps.push(...list);
    },
    command(def: AddonCommandDef) {
      if (typeof def?.type !== 'string' || !COMMAND_TYPE.test(def.type) || !def.type.startsWith(m.commandPrefix) || def.type === m.commandPrefix) {
        throw new Error(`Command names must start with ${m.commandPrefix} (got "${String(def?.type)}").`);
      }
      if (o.reservedTypes?.has(def.type) || a.commands.some((c) => c.type === def.type)) throw new Error(`The command name ${def.type} is taken.`);
      if (def.right !== null && !(typeof def.right === 'string' && isRight(def.right))) throw new Error(`${def.type}: unknown right "${String(def.right)}".`);
      if (!def.schema || typeof def.schema.safeParse !== 'function' || typeof def.apply !== 'function') throw new Error(`${def.type} needs a schema and apply().`);
      a.commands.push({
        type: def.type,
        schema: def.schema as CommandHandler['schema'],
        right: def.right,
        needsOrder: !!def.needsOrder,
        allowWhenDayClosed: !!def.allowWhenDayClosed,
        internal: !!def.internal,
        apply: (ctx, payload, order) => def.apply(ctx, payload, order),
      });
    },
    route(method: string, routePath: string, handler: AddonRoute['handler'], opts: { access: AddonAccess; right?: Right | null }) {
      if (method !== 'GET' && method !== 'POST') throw new Error('Add-on routes are GET or POST.');
      if (typeof routePath !== 'string' || !ROUTE_PATH.test(routePath)) throw new Error(`Bad route path "${String(routePath)}".`);
      if (opts?.access !== 'staff' && opts?.access !== 'guest') throw new Error('Say whether a route is for staff or guests.');
      const right = opts.right ?? null;
      if (right !== null && !isRight(right)) throw new Error(`Unknown right "${String(right)}".`);
      if (opts.access === 'guest' && right) throw new Error('Guest routes cannot need a right.');
      a.routes.push({ method, path: routePath, access: opts.access, right, handler });
    },
    /** Serves a package file at `/a/<id>/<urlPath>` (guest pages: html, js, css, images). */
    static(urlPath: string, file: string) {
      if (!a.files.has(file)) throw new Error(`static(): ${file} is not in the package.`);
      if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(urlPath) || urlPath.includes('..') || urlPath.startsWith('api/') || urlPath.startsWith('_pkg/')) throw new Error(`Bad static path ${urlPath}.`);
      const type = TYPES[path.extname(file).toLowerCase()];
      if (!type) throw new Error(`static(): unsupported file type ${file}.`);
      a.statics.set(urlPath, { file, type });
    },
    file(contentType: AddonFile['contentType'], bytes: Uint8Array) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error('host.file() serves images only.');
      return new AddonFile(contentType, bytes);
    },
    floorBadges(source: BadgeSource) {
      if (typeof source !== 'function') throw new Error('floorBadges() takes a function.');
      a.badges.push(source);
    },
    execute,
    /**
     * Runs a command once for a given commandId: when it already ran (a retry after a crash or a dropped answer),
     * returns its first result instead of running it again, whatever the order's version is now.
     */
    executeOnce(commandId: string, type: string, payload: unknown, opts: Omit<ExecuteOptions, 'commandId'>): CommandSuccess {
      const stored = o.db.prepare('SELECT result_json FROM processed_command WHERE command_id = ?').pluck().get(commandId) as string | undefined;
      if (stored) return { ...(JSON.parse(stored) as { response: CommandSuccess }).response, duplicate: true };
      return execute(type, payload, { ...opts, commandId });
    },
    /** The add-on's own actor (no one signed in): may use only the rights its signed manifest lists. */
    systemActor(): Actor {
      return { deviceId: null, userId: null, deviceKind: 'addon', addonId: m.id, addonRights: [...(m.rights ?? [])] };
    },
    floor: () => set.rt().floor(),
    menu: () => set.rt().menu(),
    order: (orderId: string) => set.rt().order(orderId),
    config: () => set.rt().config(),
    network: () => set.rt().network(),
    newId: () => set.rt().newId(),
    onStop(fn: () => unknown) {
      if (typeof fn === 'function') a.stops.push(fn);
    },
    ensureDataDir() {
      mkdirSync(dataDir, { recursive: true });
      return dataDir;
    },
  };
  const code = a.files.get('backend.cjs')!.toString('utf8');
  const mod = { exports: {} as { register?: (h: typeof host) => void } };
  const fn = vm.compileFunction(code, ['module', 'exports', 'require', '__filename', '__dirname'], { filename: `addon:${m.id}/backend.cjs` }) as (
    module: typeof mod,
    exports: typeof mod.exports,
    require: typeof safeRequire,
    filename: string,
    dirname: string,
  ) => void;
  fn(mod, mod.exports, safeRequire, `addon:${m.id}/backend.cjs`, `addon:${m.id}`);
  const reg = mod.exports.register ?? (mod.exports as { default?: { register?: (h: typeof host) => void } }).default?.register;
  if (typeof reg !== 'function') throw new Error('backend.cjs does not export register(host).');
  reg(host);
  return steps;
}

function currentVersion(db: Db, orderId: string): number {
  const v = db.prepare('SELECT version FROM "order" WHERE id = ?').pluck().get(orderId) as number | undefined;
  if (v === undefined) throw new PosError('NOT_FOUND', 'Order not found.', { orderId });
  return v;
}

/** Applies the add-on's database steps not yet run, all or none; a step changed after it ran switches it off. */
function applySteps(db: Db, id: string, steps: string[], now: Date): void {
  const done = new Map(
    (db.prepare('SELECT seq, checksum FROM addon_migration WHERE addon_id = ?').all(id) as Array<{ seq: number; checksum: string }>).map((r) => [r.seq, r.checksum]),
  );
  steps.forEach((sql, i) => {
    const sum = done.get(i + 1);
    if (sum && sum !== sha256(Buffer.from(sql, 'utf8'))) throw new Error(`Database step ${i + 1} changed after it ran. Ask for a fixed version.`);
  });
  if (done.size > steps.length) throw new Error('This version has fewer database steps than the one that ran before.');
  const todo = steps.map((sql, i) => ({ sql, seq: i + 1 })).filter((s) => !done.has(s.seq));
  for (const s of todo) {
    const problem = sqlProblem(id, s.sql);
    if (problem) throw new Error(`Database step ${s.seq}: ${problem}`);
  }
  db.transaction(() => {
    for (const s of todo) {
      try {
        db.exec(s.sql);
      } catch (e) {
        throw new Error(`Database step ${s.seq} failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
      db.prepare('INSERT INTO addon_migration (addon_id, seq, checksum, applied_at) VALUES (?, ?, ?, ?)').run(id, s.seq, sha256(Buffer.from(s.sql, 'utf8')), now.toISOString());
    }
  }).immediate();
}

/** Statements that only read (better-sqlite3 knows: `readonly`), so add-on code outside commands cannot write. */
function readOnly(db: Db): AddonDb {
  const prep = (sql: string) => {
    const st = db.prepare(sql);
    if (!st.readonly) throw new PosError('VALIDATION', 'Add-ons change data only through their commands.');
    return st;
  };
  return {
    get: <T>(sql: string, ...params: unknown[]) => prep(sql).get(...params) as T | undefined,
    all: <T>(sql: string, ...params: unknown[]) => prep(sql).all(...params) as T[],
  };
}

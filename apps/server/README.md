# @dinepos/server — outlet server (the single writer)

Runs on the master PC. Owns `dinepos.db`. Exposes HTTP commands/queries and a WebSocket stream, runs the
print queue, backups, licence checks and (later) cloud sync.

Read first: `docs/01-architecture.md`, `docs/03-command-api.md`, `docs/05-sync-offline.md`.

## Folder plan
```
src/
  index.ts              entry: load config, open DB, migrate, start Fastify, workers
  config.ts             port, dataDir, env (dev/prod)
  db/
    connection.ts       open better-sqlite3, pragmas (WAL, synchronous=FULL, foreign_keys, busy_timeout)
    migrate.ts          apply migrations/NNNN_*.sql in order; table schema_migrations
    migrations/0001_init.sql
  core/
    errors.ts           PosError + codes
    execute-command.ts  the pipeline (see docs/01-architecture.md)
    context.ts          CommandContext: db, now(), user, device, businessDate, emit(), audit(), print()
    counters.ts         nextBillNo(fy), nextKotNo(date)
    rights.ts           requireRight(ctx, right) incl. PIN logic
  commands/
    registry.ts         type → { schema, handler, right, needsOrder }
    open-table.ts, add-items.ts, fire-kot.ts, print-bill.ts, settle.ts, ...
    *.test.ts           one test file per handler
  queries/
    floor.ts, order-snapshot.ts, menu.ts, reports/*.ts
  routes/
    commands.ts, queries.ts, stream.ts, health.ts, static.ts (serves captain/kds builds)
  realtime/
    hub.ts              topics, subscribe, publish, replay from event_log
  print/
    worker.ts, registry.ts
  auth/ license/ backup/ sync/
scripts/
  seed-dev.ts
```

## Handler contract
```ts
export const fireKot = defineCommand({
  type: 'FireKOT',
  schema: fireKotSchema,          // zod, from packages/shared/src/schemas/commands/
  right: 'kot.fire',              // null only if any signed-in user may send it
  needsOrder: true,               // envelope must carry orderId + expectedVersion
  apply(ctx, payload, order) {
    // mutate via ctx.db prepared statements (already inside the IMMEDIATE transaction)
    // ctx.emit(['station:x', 'kds'], 'kot.created', data)
    // ctx.print({ printerId, docKind: 'kot', refId: kotId, bytes, previewText })
    // ctx.audit({ entity: 'kot', entityId, action: 'kot.fire', after, leakage? })
    // ctx.touchOrder(otherOrderId)  — e.g. merge target, so its version bumps too
    return { result: { kotIds } };  // creators also return { orderId }
  },
});
```
`executeCommand` (`core/execute-command.ts`) validates the envelope and payload, replays a known
`commandId`, refuses a closed day, loads the order and checks `expectedVersion`, asks the `RightsPolicy`,
runs `apply`, bumps `order.version` by one, emits `order.updated`, writes audit/event_log/print_job/outbox
and `processed_command`, then commits. Events and printer wake-ups go out after commit only. If `apply`
records no audit entry, a generic `command.<Type>` row is written. Handlers never call `BEGIN`/`COMMIT`,
never do network or file I/O, and never `await`.

Auth (P2-01): `auth/authenticate.ts` `sessionAuth` turns `X-User-Session` into the actor (and `X-Manager-Pin` for
approvals); `core/rights.ts` `roleRights` checks the role. `singleTerminalAuth` + `allowAllRights` remain for tests
and tools only. Device tokens (P2-02) will add to the same interface.

## Testing
`createTestDb()` (`src/testing/test-db.ts`) → `:memory:` DB with all migrations. Call `executeCommand`
with a test `RightsPolicy` that throws `forbidden()` / `pinRequired()` to cover those paths;
`src/testing/fake-commands.ts` shows the pattern. Every handler: happy path, VERSION_CONFLICT, FORBIDDEN,
DUPLICATE replay, INVALID_STATE.

## Runtime (P1-02)
| Env var | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` switches the DB file to `dinepos.db` and the data dir default |
| `DINEPOS_HOST` / `DINEPOS_PORT` | `0.0.0.0` / `7420` | port `0` picks a free port (tests) |
| `DATA_DIR` | dev `./data`, prod `%ProgramData%\DinePOS` (`/var/lib/dinepos` elsewhere) | holds DB, `backups/`, `logs/`, lock |
| `DINEPOS_TIMEZONE` | `Asia/Kolkata` | business date and `serverTime` |
| `LOG_LEVEL` | `info` | JSON logs (pino); auth headers are redacted |
| `DINEPOS_LOG_TO_FILE` | `1` in production | `1`: JSON logs to `<DATA_DIR>/logs/server-<date>.log`, console shows the banner |
| `DINEPOS_ALLOWED_ORIGINS` | `app://dinepos,http://localhost:5173,http://127.0.0.1:5173` | browser origins for CORS and `/v1/stream` |
| `DINEPOS_DISCOVERY` | on | `0` stops answering discovery probes on UDP `DINEPOS_PORT` (P2-15, `src/discovery/`) |

Startup: data dir → `dinepos.lock` (refuses a second server; a lock from a crashed pid is taken over; a lock
from another host means the DB is on a shared folder and is refused) → open DB (pragmas read back) → migrate →
open business date → server id (P2-15, `core/server-id.ts`) → listen → discovery responder. SIGINT/SIGTERM close HTTP, checkpoint the WAL and release the lock (10 s limit).

Migration 0003 adds `bill_document` (printed bill revisions) and triggers: bills never deleted, settled bills
frozen (except → void), bill numbers never change, payments append-only.

Migrations: `src/db/migrations/NNNN_name.sql`, numbered without gaps, each in its own IMMEDIATE transaction.
SHA-256 checksums (LF-normalised) go in `schema_migration_checksum`; an edited applied migration or a database
newer than the build stops startup. `npm run build` copies the SQL into `dist/`.

## Dev seed (P1-05)
With the server running: `npm run seed -w @dinepos/server` (`DINEPOS_URL` to target another port). It sends the
demo outlet (`src/seed/dev-seed.ts`: 2 areas, 12 tables, 3 stations, 4 fake printers, 30 items, 8 stock materials with opening
stock and recipes) as normal admin
commands over HTTP, so the server stays the only DB writer. Ids derive from stable keys, so re-running is safe.
Refuses to run with `NODE_ENV=production`.

## Run it like the order hub
`npm start` (repo root) bundles the server and runs it in production mode: data in `%ProgramData%\DinePOS`
(`DATA_DIR` to change), port 7420 (`DINEPOS_PORT`). It prints the addresses for this PC and for billing terminals,
the data folder and the log file; Ctrl+C or closing the window stops it cleanly. On shop PCs the installer's
"DinePOS Server" shortcut does the same with the bundled node.exe (the bundle defaults to production, so the
shortcut needs no environment variables).

## Dev
`npm run dev -w @dinepos/server` → `tsx watch src/index.ts` with `apps/server/data/dev.db`, fake printers.
`npm run build -w @dinepos/server && npm run start -w @dinepos/server` runs the compiled server.

## Backups (P2-08)
`src/backup/`: `backups.ts` (make, check, list, prune, copy, stage and apply a restore) and `scheduler.ts` (every 15 min,
day end, on request). Files live in `<DATA_DIR>/backups`. If the server cannot start, run it with `--list-backups`, then
`--restore <file>`: the restore is applied at that start and the old database is kept in `pre-restore-<time>/`.

# Phase 1 prompts — floor + KOT core

## P1-01
Implement roadmap task P1-01 (workspace packages). Read CLAUDE.md and docs/01-architecture.md. Install
zod, ulid, fastify, @fastify/websocket, better-sqlite3 (+ @types), pino, tsx where they belong. Add an
ESLint flat config for TypeScript. Make `npm install && npm run typecheck && npm run test` pass. Tick the task.

## P1-02
Implement P1-02. Build the Fastify server on port 7420 with GET /v1/health, the DB connection with the
pragmas from CLAUDE.md, and a migration runner that applies apps/server/src/db/migrations/*.sql in order
and records them in schema_migrations. DATA_DIR env var, default ./data. Tests: fresh DB migrates once,
second start is a no-op.

## P1-03
Implement P1-03 in packages/shared: money.ts, tax.ts, bill-calc.ts exactly per docs/08-billing-gst.md.
Integer paise only. Include a property test (random orders, 1,000 runs) proving discount allocation and
split allocation always sum exactly to the total. Ask me before choosing any rounding rule the doc does not state.

## P1-04
Implement P1-04: the command pipeline per docs/01-architecture.md and docs/03-command-api.md — envelope
schema, PosError, executeCommand with BEGIN IMMEDIATE, idempotency via processed_command, expectedVersion
check, rights hook (allow-all stub for now), audit_event + event_log rows, post-commit publish hook,
command registry, POST /v1/commands. Include a dummy `Ping` command for tests. Prove rollback leaves no rows.

## P1-05
Implement P1-05: admin Upsert* commands for area, table, category, menu item (+variants, addon groups),
station, printer; GET /v1/menu and GET /v1/floor; scripts/seed-dev.ts with 2 areas (Main hall, Terrace),
12 tables, stations Tandoor/Chinese/Bar, 30 realistic Indian menu items with variants and add-ons,
fake printers. Seed must be idempotent.

## P1-06
Implement P1-06: OpenTable, AddItems, UpdateHeldItem, RemoveHeldItem, FireKOT, plus deriveTableState in
packages/shared. Follow station routing in docs/06-printing-kds.md and invariants in docs/02-domain-model.md.
Create print_job rows (use a temporary text renderer until P1-07). Tests for every acceptance criterion.

## P1-07
Implement P1-07: packages/printing (ESC/POS builder, KOT and bill templates for 58/80 mm with text previews,
tcp/usb/fake transports) and the server print worker with retry, backoff, reroute to backup printer, and
print.status events. Snapshot-test previews. Replace the temporary renderer from P1-06.

## P1-08
Implement P1-08: apps/desktop Electron + Vite + React shell, settings for server URL, Floor screen from
GET /v1/floor, WS client with resumeFrom + heartbeat. Use the original design tokens in docs/09-ui-screens.md.

## P1-09
Implement P1-09: the billing screen per docs/09-ui-screens.md — categories, item grid with short-code search,
modifier sheet, held/fired cart, Fire, keyboard shortcuts, conflict banner.

## P1-10
Implement P1-10: PrintBill (discount, optional service charge, FY bill numbering), Settle (multi-tender),
DayEnd with Z-report; Settle screen in desktop. Follow docs/08-billing-gst.md exactly; ask before any tax
assumption not written there.

## P1-11
Implement P1-11: run the server as a Windows service on the master, and an electron-builder NSIS installer
with an "Install as master" option and data dir %ProgramData%\DinePOS. Document the install steps in README.

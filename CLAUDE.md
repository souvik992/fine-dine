# CLAUDE.md — instructions for Claude Code in this repo

You are implementing **DinePOS**, an offline-first fine-dine POS. The `docs/` folder is the source of
truth. When code and docs disagree, stop and ask, or update the doc in the same change with a note.

## Before writing any code
1. Read `docs/10-roadmap.md` and find the task you were given (IDs like `P1-03`).
2. Read every doc the task lists under **Read first**. Also read `docs/02-domain-model.md` if you touch orders.
3. Read the README.md of each app/package you will change.
4. State a short plan (files to add/change, tests to write) before editing.

## Non-negotiable architecture rules
- **Single writer.** Only `apps/server` opens the SQLite file. Clients (desktop, captain, kds) talk HTTP/WS
  to the server. Never open the DB from Electron renderer or a network share.
- **All writes are commands.** `POST /v1/commands` with the envelope in `docs/03-command-api.md`. No ad-hoc
  write endpoints.
- **One transaction per command.** Inside `BEGIN IMMEDIATE`: check idempotency → load order → check
  `expectedVersion` → check rights → apply → bump `order.version` → insert `audit_event` (+ `outbox`,
  `print_job`, `event_log` rows) → store `processed_command` → COMMIT. Publish WS events and wake printers
  only **after** commit.
- **Money is integer paise.** Never use floats for money. Tax rates are integer basis points (500 = 5%).
  Use helpers in `packages/shared/src/money.ts`.
- **Audit log is append-only.** Never UPDATE/DELETE `audit_event`. Voids are reversals, never deletes.
- **Bill numbers** are assigned only by the server inside `PrintBill`, gap-free per financial year.
- **Table state is derived**, not stored (see `deriveTableState` in `packages/shared`).
- **Snapshots on order lines.** Copy item name, price and tax rate onto `order_item` at add time.
- **IDs** are ULIDs created where the record is born (clients may create `commandId` and `orderItem` ids).
- **No vendor copying.** UI, names, icons and assets must be original.

## Code conventions
- TypeScript strict everywhere. ESM modules. Node 22.
- Validation with `zod`; schemas live in `packages/shared/src/schemas/` and are imported by server and clients.
- Server: Fastify, `ws`, `better-sqlite3` (synchronous API, one write connection).
- Tests: `vitest`. Every command handler gets tests for: happy path, version conflict, missing right,
  idempotent replay, invalid state. Use an in-memory DB (`:memory:`) with migrations applied.
- File names kebab-case; one command handler per file in `apps/server/src/commands/`.
- Errors: throw `PosError(code, httpStatus, details)`; codes listed in `docs/03-command-api.md`.
- Keep functions small; no business logic in route files.

## Commands you can run
- `npm install` · `npm run test` · `npm run typecheck` · `npm run lint` · `npm run check` (all three)
- `npm run dev:server` (after P1-02) · `npm run dev:desktop` (after P1-08)
- Single workspace: `npm run test -w @dinepos/server`

## Definition of done for a task
- Acceptance criteria in the roadmap all pass (write a test per criterion where possible).
- `npm run typecheck` and `npm run test` pass.
- Docs updated if behaviour or schema changed (schema changes go in a new migration file, never edit old ones).
- Tick the task checkbox in `docs/10-roadmap.md` and add one line to `CHANGELOG.md`.
- Summarise what changed and how to try it manually.

## When unsure
Ask one clear question instead of guessing on: tax rules, money rounding, anything that changes a printed
bill, deleting data, or schema changes to existing tables.

# 10 — Roadmap (implement top to bottom)

Run `/implement-task <ID>` in Claude Code for each task. Tick `[x]` when done.
Each task lists **Read first**, **Build**, and **Accept** (acceptance criteria → tests).

---

## Phase 1 — Floor + KOT core (single terminal)

- [x] **P1-01 Workspace packages**
  - Read first: `01-architecture.md`, `packages/shared/README.md`
  - Build: `packages/shared` and `packages/printing` package.json + tsconfig; `apps/server` package.json +
    tsconfig; root `npm run typecheck` passes; eslint flat config.
  - Accept: `npm install && npm run typecheck && npm run test` all succeed.

- [x] **P1-02 Server bootstrap + DB**
  - Read first: `01-architecture.md`, `apps/server/README.md`, `apps/server/src/db/migrations/0001_init.sql`
  - Build: Fastify app on :7420, `/v1/health`; DB open with pragmas; migration runner (applies `NNNN_*.sql`
    in order, records in `schema_migrations`); `npm run dev -w @dinepos/server` with `data/dev.db`.
  - Accept: fresh start creates DB and applies 0001; restart does not re-apply; health returns version + businessDate.

- [x] **P1-03 Shared money + tax helpers**
  - Read first: `08-billing-gst.md`
  - Build: `money.ts` (paise ops, roundHalfUp, allocateLargestRemainder), `tax.ts` (exclusive/inclusive line tax, CGST/SGST split), `bill-calc.ts`.
  - Accept: unit tests incl. property test "allocation always sums to total"; no floats in results.

- [x] **P1-04 Command pipeline**
  - Read first: `03-command-api.md`, `05-sync-offline.md`, `CLAUDE.md` rules
  - Build: envelope zod schema, `PosError`, `executeCommand()` (IMMEDIATE tx, idempotency, version check,
    rights hook, audit + event_log rows, post-commit publish), command registry, `POST /v1/commands`.
  - Accept: tests for DUPLICATE replay, VERSION_CONFLICT, VALIDATION, rollback on handler throw (no partial rows).

- [x] **P1-05 Menu + areas + tables admin (seed)**
  - Read first: `02-domain-model.md`
  - Build: admin commands `UpsertArea/Table/Category/MenuItem/Station/Printer`; `scripts/seed-dev.ts` with
    2 areas, 12 tables, 3 stations, 30 items incl. variants/addons; `GET /v1/menu`, `GET /v1/floor`.
    (Seed lives in `apps/server/src/seed/` and runs over HTTP: `npm run seed -w @dinepos/server`.)
  - Accept: seed runs idempotently; floor returns 12 FREE tables.

- [x] **P1-06 Order commands: OpenTable, AddItems, Update/RemoveHeldItem, FireKOT**
  - Read first: `02-domain-model.md`, `03-command-api.md`, `06-printing-kds.md` (routing)
  - Build: handlers + `deriveTableState` in shared + KOT numbering + station routing + print_job rows.
  - Accept: firing items for 2 stations creates 2 KOTs with consecutive numbers; table state transitions
    FREE→SEATED→KOT_RUNNING; snapshots copied; cannot fire on settled order (INVALID_STATE).

- [x] **P1-07 Printing package + worker**
  - Read first: `06-printing-kds.md`, `packages/printing/README.md`
  - Build: ESC/POS builder, KOT + bill templates (58/80 mm), transports `tcp`, `usb` (stub on non-Windows), `fake`; server print worker with retry/backoff/reroute.
  - Accept: fake printer writes text previews matching snapshot tests; failed TCP job retries 3 times then
    `failed` and emits `print.status`.

- [x] **P1-08 Desktop app shell**
  - Read first: `09-ui-screens.md`, `apps/desktop/README.md`
  - Build: Electron + Vite + React; settings for server URL; Floor screen from `/v1/floor`; WS client with resume.
  - Accept: two desktop windows show the same table state change within 1 s.

- [ ] **P1-09 Billing screen**
  - Build: categories, items, modifier sheet, held/fired cart, Fire, keyboard shortcuts, short-code search.
  - Accept: punch 5 items with modifiers and fire in under 20 s using keyboard only (manual check).

- [ ] **P1-10 PrintBill + Settle + DayEnd**
  - Read first: `08-billing-gst.md`
  - Build: `PrintBill` (discount, optional service charge, bill numbering per FY), `Settle` (multi-tender),
    `DayEnd` + Z-report, desktop Settle screen.
  - Accept: bill math tests incl. discount allocation and round-off; bill numbers gap-free across restart;
    table returns FREE after settle; DayEnd blocked with open orders.

- [ ] **P1-11 Windows service + installer (master)**
  - Build: run server as a Windows service; electron-builder NSIS installer with "Install as master" option;
    data dir `%ProgramData%\DinePOS`.
  - Accept: reboot → service auto-starts; desktop connects without manual steps.

## Phase 2 — Bill operations + multi-terminal + rights

- [ ] **P2-01 Users, roles, rights, PIN sessions** (`07-security-licensing.md`) — Accept: FORBIDDEN and PIN_REQUIRED paths tested.
- [ ] **P2-02 Device pairing + device tokens** — Accept: unpaired device gets 401; revoke works instantly.
- [ ] **P2-03 MoveTable, MergeTables, TransferItems** — Accept: KOT history preserved; move_notice KOT printed; leakage flags set.
- [ ] **P2-04 ModifyFiredItem, CancelFiredItem, Reprint*** — Accept: delta slips render; leakage flags; PIN rules.
- [ ] **P2-05 SplitBill (equal/items/proportion)** — Accept: property test Σparts = total for 1,000 random orders.
- [ ] **P2-06 VoidBill + PayIn/PayOut + OpenDrawer** — Accept: void keeps bill number; reports show VOID.
- [ ] **P2-07 Second terminal over LAN + conflict UX** — Accept: two terminals editing T7 never lose an item; conflict banner appears for Move vs PrintBill race.
- [ ] **P2-08 Backups + restore** — Accept: restore from a 15-min backup reproduces open orders.
- [ ] **P2-09 Licence verification + seats** — Accept: expired key → warning, grace, then DayEnd/new date blocked; seat limit at pairing.

## Phase 3 — Captain app

- [ ] **P3-01 Captain PWA shell served at /captain** (pairing, PIN login, tables list)
- [ ] **P3-02 Order taking + course-wise firing**
- [ ] **P3-03 Offline outbox + replay + "Needs attention" list** (`05-sync-offline.md`)
- [ ] **P3-04 Captain assignment to areas/tables + Request bill notification**
- [ ] **P3-05 Captain performance report**

## Phase 4 — Controls, KDS, reports, cloud

- [ ] **P4-01 Audit viewer + leakage dashboard**
- [ ] **P4-02 KDS PWA + bump + kitchen-speed report**
- [ ] **P4-03 Reports v1**: day-end, item-wise, category-wise, GST summary, payment modes, discounts,
  cancelled/void, KOT modifications, area-wise, table turnover, cash register.
- [ ] **P4-04 Reservations + waitlist (blocks tables)**
- [ ] **P4-05 Cloud sync agent (outbox up, menu/licence down)**
- [ ] **P4-06 Online orders relay (own website first)**

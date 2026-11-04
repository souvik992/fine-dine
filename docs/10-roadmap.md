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

- [x] **P1-09 Billing screen**
  - Build: categories, items, modifier sheet, held/fired cart, Fire, keyboard shortcuts, short-code search.
  - Accept: punch 5 items with modifiers and fire in under 20 s using keyboard only (manual check).
    Also automated in `apps/desktop/e2e` (seat + 5 items + fire ≈ 33 keystrokes).

- [x] **P1-10 PrintBill + Settle + DayEnd**
  - Read first: `08-billing-gst.md`
  - Build: `PrintBill` (discount, optional service charge, bill numbering per FY), `Settle` (multi-tender),
    `DayEnd` + Z-report, desktop Settle screen.
  - Accept: bill math tests incl. discount allocation and round-off; bill numbers gap-free across restart;
    table returns FREE after settle; DayEnd blocked with open orders.

- [ ] **P1-11 Server on the master + installer** — built 2026-11-02. Changed by the product owner the same day:
  the server runs standalone like the order hub (shortcut + optional start with Windows), not as a Windows service.
  Waiting for the on-PC acceptance in `apps/desktop/README.md` before ticking.
  - Build: standalone server (DinePOS Server shortcut, optional start with Windows); electron-builder NSIS
    installer with "Install as master" option; data dir `%ProgramData%\DinePOS`.
  - Accept: reboot + sign in → server starts by itself; desktop connects without manual steps.

## Phase 2 — Bill operations + multi-terminal + rights

- [x] **P2-01 Users, roles, rights, PIN sessions** (`07-security-licensing.md`) — Accept: FORBIDDEN and PIN_REQUIRED paths tested.
- [x] **P2-02 Device pairing + device tokens** — Accept: unpaired device gets 401; revoke works instantly.
- [x] **P2-03 MoveTable, MergeTables, TransferItems** — Accept: KOT history preserved; move_notice KOT printed; leakage flags set.
- [x] **P2-04 ModifyFiredItem, CancelFiredItem, Reprint*** — Accept: delta slips render; leakage flags; PIN rules.
- [x] **P2-05 SplitBill (equal/items/proportion)** — Accept: property test Σparts = total for 1,000 random orders.
- [x] **P2-06 VoidBill + PayIn/PayOut + OpenDrawer** — Accept: void keeps bill number; reports show VOID.
- [x] **P2-07 Second terminal over LAN + conflict UX** — Accept: two terminals editing T7 never lose an item; conflict banner appears for Move vs PrintBill race.
- [x] **P2-08 Backups + restore** — Accept: restore from a 15-min backup reproduces open orders.
- [x] **P2-09 Licence verification + seats** — Accept: expired key → warning, grace, then DayEnd/new date blocked; seat limit at pairing.
- [x] **P2-10 Stock: materials, purchases, recipes, wastage, usage** (added 2026-11-02 at the product owner's request, from
  TiffinPOS; `02-domain-model.md` "Stock", ADR-0003) — Accept: ledger = cached balance; FireKOT uses variant/item/add-on
  recipes; purchase void reverses stock and cost; usage report opening + in − out = closing; stock.manage enforced.
- [x] **P2-11 Menu bulk upload + sold out** (added 2026-11-02, from TiffinPOS) — Accept: CSV checked row by row, imported
  all or nothing, categories matched ignoring case; `SetItemAvailability` (menu.stock) from the billing screen.
- [x] **P2-12 Bill design** (added 2026-11-02, from TiffinPOS; `06-printing-kds.md` "Bill design") — Accept: defaults
  print the standard bill unchanged; each display option tested; logo prints as GS v 0 raster; live preview of
  unsaved settings; sample bill marked and unnumbered; legal fields cannot be hidden.
- [x] **P2-13 Dish photos + Photos view** (added 2026-11-04 at the product owner's request, from TiffinPOS) — Accept:
  photo per dish (resized to WebP in the app, real image bytes only, stored once, in backups); bulk photos matched by
  file name or code; billing screen List / Photos view per terminal; photos go to the order hub with the menu.
- [x] **P2-14 Recipe bulk upload** (added 2026-11-04) — Accept: CSV `dish,size,addon,material,quantity` checked line by
  line against menu and materials; all or none; download current recipes in the same format; KOTs then use them.

## Phase 3 — Captain app

- [x] **P3-01 Captain PWA shell served at /captain** (pairing, PIN login, tables list)
- [x] **P3-02 Order taking + course-wise firing**
- [x] **P3-03 Offline outbox + replay + "Needs attention" list** (`05-sync-offline.md`)
- [x] **P3-04 Captain assignment to areas/tables + Request bill notification**
- [x] **P3-05 Captain performance report**

## Phase 4 — Controls, KDS, reports, cloud

- [x] **P4-01 Audit viewer + leakage dashboard**
- [x] **P4-02 KDS PWA + bump + kitchen-speed report**
- [x] **P4-03 Reports v1**: day-end, item-wise, category-wise, GST summary, payment modes, discounts,
  cancelled/void, KOT modifications, area-wise, table turnover, cash register.
- [x] **P4-04 Reservations + waitlist (blocks tables)**
- [x] **P4-05 Cloud sync agent (outbox up, menu/licence down)**
- [x] **P4-06 Online orders relay (own website first)**

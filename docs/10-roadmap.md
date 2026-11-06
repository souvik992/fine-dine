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
- [x] **P2-15 Master gets a new IP: screens stay paired** (added 2026-11-06 at the product owner's request;
  `01-architecture.md` "Ports and discovery") — Accept: server id made once and kept across restarts, shown in health;
  a UDP probe gets id, outlet name, computer name and port, anything else is ignored, a taken port does not stop the
  server; DinePOS Kitchen follows only its own server id to a new address and keeps its pairing and station (another
  outlet starts fresh); setup page lists servers found on the network; banner and Settings show the `.local` address.

## Phase 3 — Captain app

- [x] **P3-01 Captain PWA shell served at /captain** (pairing, PIN login, tables list)
- [x] **P3-02 Order taking + course-wise firing**
- [x] **P3-03 Offline outbox + replay + "Needs attention" list** (`05-sync-offline.md`)
- [x] **P3-04 Captain assignment to areas/tables + Request bill notification**
- [x] **P3-05 Captain performance report**
- [x] **P3-06 Captain Android app** (added 2026-11-06 at the product owner's request; `apps/captain-android`) — Accept:
  installable signed APK that opens the server's `/captain` page (never a copy); setup checks `/v1/health` and lists
  servers found on the Wi-Fi; only the server's own pages open, permissions denied; offline start uses the page's
  service worker; follows its own server id to a new IP and carries the pairing and unsent offline orders over.

## Phase 4 — Controls, KDS, reports, cloud

- [x] **P4-01 Audit viewer + leakage dashboard**
- [x] **P4-02 KDS PWA + bump + kitchen-speed report**
- [x] **P4-03 Reports v1**: day-end, item-wise, category-wise, GST summary, payment modes, discounts,
  cancelled/void, KOT modifications, area-wise, table turnover, cash register.
- [x] **P4-04 Reservations + waitlist (blocks tables)**
- [x] **P4-05 Cloud sync agent (outbox up, menu/licence down)**
- [x] **P4-06 Online orders relay (own website first)**

## Phase 5 — Add-ons

- [x] **P5-01 Signed add-on platform** (ADR-0004): loader with Ed25519 signature, folder = id, minPosVersion, file
  fingerprints, anti-rollback; add-on database steps on its own tables only; add-on commands through the pipeline
  (`internal` for its own code); staff routes `/v1/addons/<id>`, guest pages and API `/a/<id>` (rate limited); floor tile
  badges; the add-on's own actor limited to its signed rights; terminal screens loaded only after the terminal checks the
  signature itself (nav, settings, overlay); Settings › Add-ons. Accept: a tampered, unsigned, too new, older or failing
  add-on is switched off with a reason and DinePOS starts; its writes are audited commands.
- [x] **P5-02 Table QR add-on (outlet Wi-Fi)** (`addons/tableqr`): a code per table (renewable) and a printable sheet;
  guest menu, cart and order; accepting by staff (default) or straight to the kitchen; call waiter; ask for the bill; the
  running bill; alerts with a chime on every terminal screen; marks on the floor tiles (desktop and captain). Accept: an
  accepted order is seated, added and fired once (retries never repeat food); prices always from the server.
- [x] **P5-03 Table QR through the order hub**: the same guest page served by the hub, so phones on mobile data can order;
  requests relayed over the existing hub connection (the outlet still accepts no incoming internet connections). Codes
  open `<hub>/s/<store>/a/tableqr/`; the hub passes each request down the outlet's event stream and the outlet answers
  (pos-backend `hub/src/relay.ts`, DinePOS `OnlineConnector.answerGuest`). Accept: works with online orders off; only an
  add-on's guest pages, only while it allows it; rate limited per guest; nothing stored on the hub.
- [x] **P5-04 Guest UPI payment (staff confirms)**: once the bill is printed the guest's UPI app opens with the outlet's UPI
  id and the exact amount; "I have paid" marks the table; a cashier with `bill.settle` confirms and the bill is settled as
  UPI ("Table QR").
- [x] **P5-05 Add-on installer**: `DinePOS-TableQR-Setup-<version>.exe` (NSIS, administrator) copies the signed package to
  `C:\ProgramData\DinePOS\addons\tableqr`; uninstall keeps its data.

## Phase 6 — DinePOS Cloud (ADR-0005)

- [x] **P6-01 DinePOS Cloud service** (`cloud/hub`): a separate cloud service for DinePOS only, copied from the Tiffin
  hub and rebranded (service `dinepos-cloud`, one-line AWS installer from this repository): website orders, Swiggy /
  Zomato through UrbanPiper, sales sync, licence renewals, backups, Table QR relay, website builder. Accept: its tests
  pass (`npm run test:cloud`); a DinePOS outlet connects to it like to the old hub.
- [x] **P6-02 Devices from anywhere (relay)**: terminals, captain phones and kitchen screens reach the outlet PC through
  the cloud (HTTP and the live stream down the outlet's own connection); pairing and rights unchanged; billing stays
  offline-safe on the LAN. Each outlet is at `https://<store>.<cloud>` (HTTPS made on demand for known stores only);
  the outlet keeps one outgoing WebSocket (`/v1/pos/tunnel`); Settings › Cloud sync › Devices from anywhere. Accept: a
  device through the cloud is never the trusted master PC (no token: 401); the live stream works for paired devices.
- [x] **P6-03 Cloud printing**: a print agent at the outlet prints KOTs and bills queued in the cloud.
  `apps/print-agent` (DinePOS-PrintAgent-Setup: Node runtime + agent, runs at Windows start as SYSTEM) long-polls
  `/v1/print-agent/jobs` with its own key (made on the terminal, only its hash stored); printers are assigned with
  SetPrinterAgent; the print queue keeps jobs, retries, backup printer and status. Accept: a KOT for an agent's printer
  prints on the agent's network printer; a refusing printer fails with the agent's reason; an agent gone quiet shows
  its printers offline; a removed key is refused.
- [ ] **P6-04 Hosted outlets**: the DinePOS server runs in the cloud, one database per outlet, chosen per outlet; no
  master PC; printing through the agent.


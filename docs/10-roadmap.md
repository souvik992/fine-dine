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
- [x] **P6-04 Hosted outlets**: the DinePOS server runs in the cloud, one database per outlet, chosen per outlet; no
  master PC; printing through the agent. The cloud runs `cloud/outlet-server` (the server bundle for Linux,
  `npm run bundle:cloud -w @dinepos/server`) per hosted outlet on 127.0.0.1 and proxies `https://<store>.<cloud>` to it;
  admin page: run in the cloud, first step (outlet, owner, PIN), approve the first device's pairing code. Accept: the
  proxy never makes a device the master (no token: 401, even with the host key sent from outside); a device pairs and
  works; the master PC takes no licence seat; each hosted outlet has its own hardware id.
- [x] **P6-05 Brand website: orders go to the nearest outlet** (added 2026-11-07 at the product owner's request; before
  it, every website order went to the one store in the URL, `/order/<store>`, and the address only checked that store's
  delivery areas). Read first: `cloud/hub/README.md`, `cloud/hub/src/hub.ts` (`storePublic`, `quote`, `placeOrder`),
  `cloud/hub/src/site.ts`, `packages/shared/src/online.ts`. The cloud admin page makes a **brand** (slug, name) and adds
  stores to it (a store is in at most one brand); the brand has its own website at `/order/<brand>`, and the store
  pages keep working. (Built: the brand website shows the published design of the brand's **main outlet**, made in
  that outlet's website builder, instead of a separate brand builder and password.) The customer gives their location first. **Delivery:** the
  outlets of the brand that can take the order right now (POS online, shift open, accepting, delivery on, the address in
  its delivery areas) are tried nearest first, by road distance when the routing server is set, otherwise straight line
  × road factor; the first that can take it gets the order. **Pickup:** the nearest open outlet that takes pickup, chosen
  automatically and named on screen before checkout. The menu, prices, GST and fees shown are that outlet's own (from
  its published menu); if the address changes, the outlet is chosen again and the cart is checked against the new
  menu. The order is created in the chosen store exactly as a store-page order (same `placeOrder` checks; the hub never
  moves it to another outlet after it is placed). Cloud schema: new tables in the hub database (`brand`, `brand_store`)
  made the same way as the existing ones. Accept: two outlets of one brand, a delivery address nearer to B goes to B; B
  closed (or the address outside B's areas) goes to A; neither can take it gives a clear "no outlet delivers here right
  now" and an `order_attempt` row; pickup goes to the nearest open outlet; a store outside the brand is never chosen;
  the outlet shown at checkout is the one that gets the order; the admin page lists each brand's outlets and their
  state; `/order/<store>` still works unchanged.
- [x] **P6-06 Swiggy / Zomato orders in DinePOS** (added 2026-11-07 at the product owner's request: Zomato orders could
  not be accepted, "outside the delivery area", because platform orders come without a distance). Read first:
  `docs/08-billing-gst.md` (Online orders), `apps/server/src/online/menu.ts`, `cloud/hub/src/urbanpiper.ts`. Settings ›
  Online orders gets Swiggy and Zomato (off by default; settings saved before still load); the published menu lists
  every dish for the platforms switched on, with DinePOS's own item ids (UrbanPiper's menu, so platform orders carry
  them). Accepting a platform order skips the distance band and bills the platform's own charges; the bill is settled
  as `other` (reference = the platform's order number) except cash the outlet's own rider collects (settled in cash
  when delivered). Accept: a Zomato delivery order without a distance is accepted with its packaging charge; a website
  delivery order without a distance is still refused; platform orders are settled as Other, a cash order the platform's
  rider collects takes no payment at the door; a self-delivery cash order is settled in cash when delivered; with the
  platforms on, each dish lists them; old settings load with both off. Not yet: the platform's OTP and rider on the
  order card, platform requests (items out of stock, rider check), per-platform menu and prices.


## Phase 7 — Accounts, demos, automatic licences, billing (ADR-0006)

Added 2026-11-07 at the product owner's request: the product website sells DinePOS with no manual steps. Read first
for every task: `docs/adr/0006-accounts-trials-billing.md`, `docs/07-security-licensing.md` (Licence),
`cloud/hub/README.md`, `cloud/hub/src/db.ts`, `cloud/hub/src/http.ts`.

- [x] **P7-01 Customer accounts** (`cloud/hub/src/accounts.ts`, `src/mailer.ts`, `public/portal.html` served at `/signup`, `/login`, `/forgot`, `/app`; built 2026-11-07, billing address and state columns come with P7-05/P7-06).
  Tables `account`, `account_user`, `account_session`, `email_code`, `account_store`. Sign up (business name, name,
  email, phone, password) → verify the email with a 6-digit code → signed in. Log in, log out, forgot password,
  change password. Mailer interface with a development driver (the code goes to the log). The portal shell shows the
  account. The admin page lists accounts. Accept: duplicate email refused; an unverified user cannot reach the
  portal; 5 wrong codes lock that code; a password reset ends all sessions; the password is never stored or logged in
  clear; sign-up rate limited per IP.
- [x] **P7-02 Cloud signing key + licence grants** (built 2026-11-07: `cloud/hub/src/licences.ts`; key pair in the keygen folder, imported on the server). The cloud key pair (`npm run admin -- cloud-key init`). DinePOS
  server trusts `master` + `cloud` public keys (`kid`; cloud keys at most 400 days). Table `licence_grant`
  (append-only). The admin page can issue or revoke a grant for an account's store, and the grant is put in the store's
  licence slot. Accept: an existing key (no `kid`) still verifies; a cloud key over 400 days is `invalid`; a key
  signed by an unknown `kid` is `invalid`; a grant reaches the outlet through the hourly renewal.
- [x] **P7-03 Windows trial + activation** (built 2026-11-07: cloud `src/activation.ts`, server `POST /v1/licence/activate`, Settings › Licence › Your DinePOS account; trial and demo keys carry the feature `trial` and warn only in their last 2 days). `POST /v1/activate` (email + password or a one-time portal code,
  hardware id, outlet name) links or creates the store, pairs the device key and returns a key. Table `trial_claim`.
  Desktop: Settings › Licence and the no-licence screen get "Sign in to your account" and "Start free trial". Accept:
  a 14-day key with trial seats installs and opens the day; a second trial for the same PC, email or phone is refused
  with a clear message; activation without internet shows "Connect to the internet to activate" and the paste-key path
  still works.
- [x] **P7-04 Instant browser demo** (built 2026-11-07: `cloud/hub/src/demos.ts`; the terminal served at `/pos/`; the seed in `cloud/outlet-server/demo-seed.json`; started from the portal). `/demo` makes a hosted outlet from a demo template (menu, tables, staff),
  licensed by the cloud key, opened in the browser terminal; deleted after 72 h; at most N at once (a setting). Table
  `demo_request`. Accept: a verified visitor gets a working floor and billing screen within 30 s; the demo shows its
  PINs; it is removed after expiry, together with its database; at the cap the visitor is offered the Windows trial.
- [ ] **P7-05 Plans and Razorpay payments**. Tables `plan`, `plan_price`, `subscription`, `payment`, `invoice`,
  `invoice_line`. Admin edits plans and add-ons; the portal Billing page; Razorpay order made on the server; payment
  confirmed by a verified signature or webhook, idempotent; one transaction for payment → invoice (gap-free number per
  FY, GST) → period → grant → licence slot. Blocked on the GST and price decisions in ADR-0006. Accept: a tampered
  amount or signature is refused; a replayed webhook changes nothing; a paid renewal reaches the outlet; invoice
  numbers have no gaps; an issued invoice cannot change.
- [ ] **P7-06 Portal features + vendor console**. Portal: Outlets, Licences (seats in use, move to a new PC once per
  30 days), Team (invite, roles owner/admin/billing), Downloads, Account (GSTIN, address). Admin: demo requests and
  conversion, extend trial, coupons, failed renewals, invoice export (CSV). Accept: a `billing` user cannot move a
  licence; moving a licence revokes the old grant and signs one for the new PC; an invite link works once.
- [ ] **P7-07 Product website** served by the cloud: home, features, pricing (from `plan`), demo, sign-up, terms,
  privacy, refund and cancellation; original design; works on a phone. Accept: the pricing page shows the plans from
  the admin page; every page loads without the admin key; the legal pages are linked from the footer and checkout.

## Phase 8 — One backend, the portal, downloads and trials for two products (ADR-0007)

Added 2026-11-08 at the product owner's request. Read first for every task: `docs/adr/0007-one-backend-two-products.md`,
`cloud/hub/README.md`, `cloud/hub/src/accounts.ts`, `cloud/hub/src/activation.ts`, `cloud/hub/src/licences.ts`.

- [x] **P8-01 Licensing library into this repository; saas-portal becomes UI only.** Move `packages/licensing` here
  (tests and fixtures included), point the hub at it, remove the `vendor/saas-portal` submodule (and its lines in the
  deploy scripts); delete saas-portal's `cloud/saas` API, its migrations and the library there. Accept: hub tests pass
  from a fresh clone without submodules; saas-portal holds only `cloud/saas-web`.
- [ ] **P8-02 Two products, 30-day trials.** `product` on licence grants and trial claims (`fine_dine`, `tiffin_qsr`);
  `/v1/activate` takes the product; trial 30 days; one trial per product per account, PC and mobile; the DinePOS app
  sends `fine_dine` and refuses keys for another product. Accept: a Tiffin trial on a PC does not use up its DinePOS
  trial; a `tiffin_qsr` key does not install in DinePOS.
- [ ] **P8-03 Builds on every push.** fine-dine CI builds and tests, then publishes `DinePOS-Setup-<v>.exe` and
  `DinePOS-TableQR-Setup-<v>.exe` to a GitHub Release on every push to main; tiffin CI publishes its installer and the
  ODS add-on the same way. Accept: a push to main produces a release with the installers attached.
- [ ] **P8-04 Download catalogue in the hub.** `GET /v1/downloads` (products and add-ons, newest version, size, date)
  from the GitHub Releases API (cached; works when GitHub is down with the last list); signed-in download links
  record who downloaded what. Accept: the newest release appears within the cache time; a download is recorded.
- [ ] **P8-05 Browser demo off.** Portal no longer offers it; `/v1/account/demo` answers "not available" unless
  `HUB_BROWSER_DEMO=1`. Accept: no demo can be started by default.
- [ ] **P8-06 Portal rebuilt (saas-portal `cloud/saas-web`) in the DinePOS look.** Home, product choice (QSR or Fine
  Dine), sign-up with email code, sign-in, forgot password, all against the hub's `/v1/account/*`. Accept: sign-up to
  signed-in works against a local hub; looks like DinePOS (orange, Manrope/Fraunces); works on a phone.
- [ ] **P8-07 Client area home and Downloads / Licences / Add-ons pages.** Tiles like a hosting client area; downloads
  for the chosen products; licences per PC with seats and end dates; add-ons per product. Accept: a Fine Dine
  customer sees the DinePOS and Table QR downloads; a QSR customer sees Tiffin POS and ODS.
- [ ] **P8-08 Support, announcements, knowledge base, service status.** Hub tables and routes; tickets with replies
  (customer and vendor), admin-page tabs to answer tickets and write announcements and articles; status from the
  hub's health. Accept: a ticket opened in the portal is answered from the admin page and the reply shows in the
  portal.
- [ ] **P8-09 Portal deployment.** saas-portal CI builds and publishes the portal on every push; the cloud server's
  update fetches it; the hub serves it on the `portal.` host with the API on the same origin; steps to point
  portal.posinext.com at the server. Accept: after an update the server serves the newest portal build.
- [ ] **P8-10 Licensing in Tiffin POS** (tiffin repository): hardware id, Settings › Licence with sign-in to DinePOS
  Cloud (`tiffin_qsr`, 30-day trial), warnings, grace, no new business day without a valid key, renewals. Accept:
  as P2-09 and P7-03, for Tiffin POS.

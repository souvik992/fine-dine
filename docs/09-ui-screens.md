# 09 — UI screens (original design)

Design goals: fast for a biller with a keyboard, big touch targets for captains, readable at a glance in a
dim dining room. Our own visual identity — do not imitate another vendor's layout, colours or icons.

## Design tokens (starting point, change freely)
| Token | Value | Use |
| --- | --- | --- |
| Font | Manrope (UI) + Fraunces (headings, table labels), bundled woff2; Noto Sans for Devanagari/Bengali later | all text |
| Base size | 15 px desktop, 17 px captain | |
| Radius | 10 px | cards, tiles |
| State: Free | neutral outline | table tile |
| State: Seated | soft blue fill | |
| State: KOT running | warm amber fill | |
| State: Bill printed | teal fill | |
| State: Reserved / Blocked | violet outline / grey hatched | |
| Danger | red | void, cancel |
Every state also has a text label and icon — colour is never the only signal.

## Desktop app (Electron)
### 1. Floor (built in P1-08: area tabs, table search, health dots, clock, tiles, seat dialog, arrow keys)
- Top bar: area tabs, search table (type `T7` + Enter), order-type buttons (Takeaway), clock, sync/print health dots.
- Layout / Grid switch (remembered per terminal): Layout shows tables where they were placed in Settings ›
  Floor & tables; areas without a saved layout fall back to the grid.
- Tile: label, covers, elapsed min, amount, captain initials, state label.
- Click: open order (or seat dialog if free). Right-click / long-press: Move, Merge, Split, Print bill, Reprint, Block.
- Keyboard: arrows move focus, Enter opens, `M` move, `G` merge, `P` print bill.

- Floor header (P2-06): **Bills** (today's numbered bills: number, table, part, payments, total, Paid / Unpaid / VOID;
  Reprint; Void with a reason, then "give back ₹… to the guest") and **Cash** (Pay in / Pay out with amount and reason,
  Open drawer with a reason; today's movements). Shown by right.

### 2. Order / billing (built in P1-09: `apps/desktop/src/billing/`)
Keyboard map: type a code + Enter (`pt2`, `pt 2`, `2*pt`; an exact code wins, so `C65` works), Shift+Enter
opens options for an item that has optional ones; in the sheet 1–9/0 toggle options, + / − quantity,
[ / ] course, Enter adds, Esc cancels; Alt+↑/↓ pick a held line, + / − its quantity, Delete removes it;
F8 fires all held items; Esc clears the search, then returns to the floor. Seating a table opens its order.
Addon options follow the order they were entered in (menu admin), so hotkeys stay stable.
Adding an item already waiting in the cart with the same size, add-ons, note and course raises that line's
quantity instead of adding a second line (lines already sent to the kitchen are never changed). Cart changes and
+ / − are decided on the latest order when their turn in the queue comes, so quick repeated taps add up.
- Left rail: categories. Middle: item grid (name, price, veg/non-veg dot, out-of-stock greyed) + search box
  with short codes (`pt2` = Paneer Tikka ×2). Right: cart.
- Cart sections: Held (editable) and Fired (grouped by KOT, read-only; actions via context menu).
- Item tap → modifier sheet: required variation, add-on groups with min/max, quick-note chips, free note,
  course selector.
- Footer buttons: Fire (F8), Fire course… , Print bill (F9), Settle (F10), More (discount, covers, captain,
  customer, transfer items).
- Conflict banner when the order changed elsewhere. Built in P2-07: a refused decision (print, settle, split, move,
  merge, move items, change a sent item) shows what was not done and who changed the table, how and when.
- Table actions (P2-03) in the order header, by right: **Move** (pick a free table), **Merge** (pick an occupied
  table: its order joins this one), **Move items** (tick lines, pick an occupied table). Whole lines only.
- After the KOT (P2-04): each sent line has a pencil button: "Keep" stepper (0 = cancel the line), reason chips or
  typed reason, "Not prepared yet" (ingredients back to stock); a manager PIN is asked when the role needs it.
  Cancelled lines stay in their KOT, struck through. Each KOT group has "Reprint". When the bill is printed the
  Bill button becomes "Reprint" (F9), printing a DUPLICATE with the same number.
- Sold out (P2-11): right-click an item tile to mark it sold out or back on (`menu.stock`). Sold-out tiles stay
  visible, greyed, with a "Sold out" label; choosing one explains why.

### 3. Settle
- Bill parts as tabs if split. Tender rows: Cash (with change calc), Card, UPI (shows QR), Due (customer
  required), Complimentary (reason + PIN). Keypad. Settle disabled until paid = total.

### 4. Split bill dialog
- Built in P2-05 (`SplitDialog.tsx`, "Split bill" in the order header once the bill is printed): tabs Equally (parts
  stepper), By item (a part column per part; + / − move one portion between parts), By share (a weight per part).
  F10 then settles part by part ("Settle B/26-27/000002 (part 2 of 3)", "Settle next part").
- Mode tabs: Equal (n stepper), By item (drag items into part columns, qty splitting), By proportion (weights).
- Live totals per part; "Unassigned" column must be empty to confirm.

### 5. Leakage dashboard (owner/manager)
- Cards: cancelled after fire, modified after fire, reprints, moves/transfers, voids, unbilled KOTs — counts
  for today, click to list with who/when/why.
- Built in P4-01 (`apps/desktop/src/reports/LeakageViews.tsx`, Reports › Owner's view): cards for cancelled after KOT,
  reduced after KOT, void bills, discounts above limit, reprints, moves and transfers, complimentary, cash out and
  drawer, day-end cash difference, plus "food made, never paid" (fired items on void orders); count and amount each;
  a card opens its events (when, what, detail, amount, why, by and device, approved by). **Audit log**: everything,
  newest first, "Flagged only", "Show older". Same dates as the reports.

### 6. Reports (built in P4-03: `apps/desktop/src/reports/`; Floor header "Reports" for `reports.view`)
Reports grouped Sales / Tax & money / Controls / Staff (Captain performance, P3-05) on the left; Today, Yesterday, Last 7 days, This month or dates
(business dates); headline figures, the table with a Total row, Download CSV (amounts as plain rupees for Excel,
formula-safe text, from the shared `reportToCsv`). Only settled bills count as sales; void bills keep their numbers
and appear in Daily sales (count, amount) and in Voids and cancellations. GST by rate comes from the bills as printed.

### 7. Settings (built with P2-01: `apps/desktop/src/settings/`)
Sections are shown by right; every save is a command, so it is audited and other terminals update live.
- **Outlet & bills** (admin): outlet name, phone, address, GSTIN, FSSAI, bill prefix, service charge, round-off and tie rule,
  UPI id/payee for the QR, bill printer, default kitchen station.
  Only changed keys are sent in one `SetConfig`.
- **Bill design** (admin, P2-12): logo (choose a picture; size Small/Medium/Large, darkness, photo dithering;
  converted to printer dots on the terminal), name size, lines under the name, "Show on the bill" switches,
  "Back to the standard choices", footer lines; a live preview at 80/58 mm that follows unsaved changes
  (`POST /v1/bill-preview`, debounced) and **Print a sample** (`PrintSampleBill`) on any bill printer.
- **Floor & tables** (admin): areas (name, price list), tables (label, seats, active), "Add several" (prefix +
  range, skips labels that exist, at most 100). Layout editor: drag tiles on a 20-unit grid, unplaced tables wait
  in a tray, "Save layout (n moved)" sends one `UpsertTable` per moved table. A table with an open order cannot
  be deactivated.
- **Menu** (admin): items (code, name, category, price, GST rate, veg, station override, variants, add-on
  groups, active), categories (station, sort), add-on groups (min/max, options), **Bulk upload** (CSV template,
  row-by-row check against the file and the menu, then `ImportMenu`, all or nothing). Saved variants and options can
  be deactivated but not removed, so old orders keep their meaning.
- **Kitchen & printers** (admin): printers (network IP/port, Windows USB name, or preview-only; paper width;
  KOT/bill role; copies; cutter; backup printer) with live status and **Test print** (`PrintTestPage`);
  stations with their printers.
- **Backups** (admin, P2-08): last backup and its health, "Back up now", the copy folder, the list of backups
  (time, kind, size) and, for staff managers, **Restore** (type RESTORE + Owner PIN; the app reconnects when the server
  is back). The top bar shows "Backup late" when there was no backup for an hour.
- **Devices** (admin, P2-02): waiting codes with Approve (manager PIN) or type a code; paired devices (kind, paired,
  last seen, signed-in count, "this terminal", "the server") with Revoke. An unpaired terminal shows **Pair this
  terminal**: a name, then a 6-digit code to approve; it opens the sign-in screen once approved.
- **Staff & roles** (users.manage): people (name, role, new PIN, active) and roles (discount limit, each right
  allowed / allowed with manager PIN / not allowed).
- **This terminal** (everyone): server address and connection test.
- Later: devices (P2-02), tax, licence, backup.

### 8. Stock (built in P2-10: `apps/desktop/src/stock/`; Floor header "Stock" button for `stock.manage`)
The button shows how many materials are low or need a count. Tabs:
- **Materials**: balance, reorder level, status (OK / Low / Count needed / Off), last cost, value; search; "Needs
  attention" filter; add (unit, reorder level, opening stock and cost), edit, adjust (Wastage / Physical count /
  Correction with a reason), history (each movement with KOT or supplier, reason and person).
- **Purchases**: latest 100 invoices; record a purchase (supplier with suggestions and remembered GSTIN, invoice
  no./date, lines with live amounts from the shared `stockAmount`); open one to see it or void it with a reason.
- **Recipes**: every dish with its ingredient count, food cost at last prices and food-cost %; a dialog per dish
  with a tab per size (variant recipes replace the dish recipe); add-on recipes below.
- **Usage report**: business-date range; opening, received, used, wasted, adjusted, closing per material, used
  and wasted value; Download CSV.

## Bookings and waitlist (built in P4-04: `apps/desktop/src/bookings/`; Floor header "Bookings")
- Header: Today / Tomorrow / a date, **New booking**. Left: bookings to come in time order (time, guest, party, tables,
  phone, length, note, who booked; **Late** after the grace time) with **Seat** (today; free tables, the booked one
  marked), **Change**, **No-show** (when late) and **Cancel**; then the day's done bookings (seated → Open order).
- Right: the waitlist, first come first, with minutes waited / minutes told (amber in the last 5, red after), **Seat**
  (free tables; a table held for a booking asks "Seat anyway?") and **Left**; **Add** asks name, phone, guests, wait told.
- Floor: a table held by a booking is RESERVED and its tile reads "14:00 · Sharma (4)"; later bookings show the same
  line on a free tile. Seating a held table asks: "These are Sharma's guests" (seats the booking) or "A walk-in: seat
  anyway". The header button shows bookings still to come and a badge with how many are waiting.

## Captain PWA (phone/tablet)
- Login with PIN → My tables (assigned areas first) → table → order screen.
- Order screen: category chips, item list with + buttons, held basket at bottom with course tags.
- Actions: Fire all / Fire course N, Request bill (notifies desk), Add note, Covers.
- Offline banner and pending-command counter.
- Built in P3-01 (`apps/captain`, served by the outlet server at `http://<master>:7420/captain`): **Pair this phone**
  (name + 6-digit code; not shown on the master PC itself) → **Who is taking orders?** (name tiles, big PIN pad) →
  **Tables** (area tabs, live states, covers, time at the table, amount; offline banner; Lock). A free table opens
  a **Seat** sheet (guests stepper); an occupied one shows its order read-only until order taking (P3-02). Installable
  (web app manifest); a service worker keeps the app shell through Wi-Fi blips.
- Order taking (P3-02): seating a table, or tapping an occupied one, opens **Table T5**: guests button (SetCovers,
  locked once the bill is printed), running total, search, category chips and a **Course 1–5** picker for quick adds.
  Each dish row has a **+** (adds one to the chosen course; the same dish/options/note/course raises the waiting line,
  as on the terminal); tapping the row, or **+** on a dish with a required choice, opens the **options sheet** (size,
  add-ons within min/max, quick notes and a note, course, quantity). The bottom bar shows what is waiting and **Fire
  all**; the **basket** groups waiting lines by course (−/+/remove, move to another course), shows what was sent by
  KOT, and offers **Fire all** plus **Fire course N** when more than one course waits. Changes from other devices
  arrive live; a refused change says who changed the table.
- Captains (P3-04): **My tables** (the captain's section and the orders they look after) is the first tab and opens by
  default when there are any; tiles show another captain's initials and "Bill asked". Tables seated on the phone are
  the captain's. The order screen's footer offers **Request bill** once something was sent and nothing waits ("Ask
  again" after); it needs the server. On the terminals: captain initials and "Bill asked" on tiles, a **Table T5 asks
  for the bill** card on every screen (oldest first; click opens the order) until the bill is printed, a **Captain**
  picker in the order header (AssignCaptain), and **Settings › Captain sections** (whole areas or single tables;
  right `staff.sections`, Owner and Manager by default).
- Offline (P3-03): an Offline banner, "N changes waiting to send" on Tables and on the order, a clock on tables and
  lines that are only on the phone, "Queued — not in the kitchen yet" in the basket, and a red **N need(s) attention**
  bar opening **Needs attention** (Try again / Discard / Seat at another table). Guests are locked while offline.

## KDS PWA
- Station selector on first run. Ticket columns, age colours, bump on tap, all-day counts sidebar.
- Large type, dark background by default (kitchen glare).
- Built in P4-02 (`apps/kds`, `http://<master>:7420/kds`): **Pair this kitchen screen** → **Which station is this
  screen for?** → the board (no sign-in after pairing): header (station, clock, to cook / ready, offline badge,
  Station), **New** tickets as cards (table, KOT no., guests, captain, age m:ss turning amber then red with
  "Waiting"/"Late" written too, lines by course with add-ons and notes, CHANGED/CANCELLED bands, a big **Ready**
  button), **Ready** (Served, and Back to New), **All day** counts; "Undo" after Served. Settings › Kitchen &
  printers on a terminal shows the address to open and the amber/red minutes.

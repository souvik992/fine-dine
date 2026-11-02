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
- Conflict banner when the order changed elsewhere.
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
- Mode tabs: Equal (n stepper), By item (drag items into part columns, qty splitting), By proportion (weights).
- Live totals per part; "Unassigned" column must be empty to confirm.

### 5. Leakage dashboard (owner/manager)
- Cards: cancelled after fire, modified after fire, reprints, moves/transfers, voids, unbilled KOTs — counts
  for today, click to list with who/when/why.

### 6. Reports

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

## Captain PWA (phone/tablet)
- Login with PIN → My tables (assigned areas first) → table → order screen.
- Order screen: category chips, item list with + buttons, held basket at bottom with course tags.
- Actions: Fire all / Fire course N, Request bill (notifies desk), Add note, Covers.
- Offline banner and pending-command counter.

## KDS PWA
- Station selector on first run. Ticket columns, age colours, bump on tap, all-day counts sidebar.
- Large type, dark background by default (kitchen glare).

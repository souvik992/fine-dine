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
- Grid or saved floor layout (drag tables in Edit layout mode).
- Tile: label, covers, elapsed min, amount, captain initials, state label.
- Click: open order (or seat dialog if free). Right-click / long-press: Move, Merge, Split, Print bill, Reprint, Block.
- Keyboard: arrows move focus, Enter opens, `M` move, `G` merge, `P` print bill.

### 2. Order / billing
- Left rail: categories. Middle: item grid (name, price, veg/non-veg dot, out-of-stock greyed) + search box
  with short codes (`pt2` = Paneer Tikka ×2). Right: cart.
- Cart sections: Held (editable) and Fired (grouped by KOT, read-only; actions via context menu).
- Item tap → modifier sheet: required variation, add-on groups with min/max, quick-note chips, free note,
  course selector.
- Footer buttons: Fire (F8), Fire course… , Print bill (F9), Settle (F10), More (discount, covers, captain,
  customer, transfer items).
- Conflict banner when the order changed elsewhere.

### 3. Settle
- Bill parts as tabs if split. Tender rows: Cash (with change calc), Card, UPI (shows QR), Due (customer
  required), Complimentary (reason + PIN). Keypad. Settle disabled until paid = total.

### 4. Split bill dialog
- Mode tabs: Equal (n stepper), By item (drag items into part columns, qty splitting), By proportion (weights).
- Live totals per part; "Unassigned" column must be empty to confirm.

### 5. Leakage dashboard (owner/manager)
- Cards: cancelled after fire, modified after fire, reprints, moves/transfers, voids, unbilled KOTs — counts
  for today, click to list with who/when/why.

### 6. Reports, 7. Settings (outlet, areas/tables, menu, stations/printers, users/roles, devices, tax, licence, backup)

## Captain PWA (phone/tablet)
- Login with PIN → My tables (assigned areas first) → table → order screen.
- Order screen: category chips, item list with + buttons, held basket at bottom with course tags.
- Actions: Fire all / Fire course N, Request bill (notifies desk), Add note, Covers.
- Offline banner and pending-command counter.

## KDS PWA
- Station selector on first run. Ticket columns, age colours, bump on tap, all-day counts sidebar.
- Large type, dark background by default (kitchen glare).

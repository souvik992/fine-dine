# 06 — Printing and KDS

Printing is a durable queue. Render bytes inside the command transaction (as `print_job` rows), send after
commit, retry until confirmed.

## Station routing
- Each `MenuItem` has a default `stationId`; a `Category` can set one for all its items; an `Area` can
  override per category (e.g. Bar area sends mocktails to the bar counter).
- Resolution order: area override → item → category → outlet default station. Area overrides and category
  stations are inherited from parent categories. The outlet default is `config` key `kot.default_station_id`;
  with no station at all `FireKOT` refuses with `INVALID_STATE`. The station is resolved when the item is fired
  (so a table move before firing routes by the new area) and stored on `order_item.station_id`.
- KOT numbers come from `counter` row `kot_no:<businessDate>`: one sequence per day across all stations, so
  one FireKOT on 3 stations prints KOT 41, 42, 43.
- `FireKOT` groups fired items by resolved station → one `kot` row per station → one `print_job` per printer
  linked to that station (a station may have 0..n printers and/or a KDS).

## Printers
| Field | Example |
| --- | --- |
| id, name | `p_tandoor`, Tandoor |
| transport | `tcp` (host, port 9100) \| `usb` (Windows printer name, RAW) \| `fake` (dev) |
| width | 58 (32 cols) \| 80 (48 cols) |
| codepage / bitmapText | bitmapText=true for Hindi/Bengali lines |
| backupPrinterId | optional |
| copies | 1..3 |
| cutter, drawerKick | booleans |

## Templates (`packages/printing/src/templates`)
### KOT (no prices)
```
KOT 0042            DINE-IN
Table T7 (Main hall)   Covers 4
Captain: Ravi     20:14  02-11-26
Course 2
--------------------------------
2  Paneer Tikka
     + extra mint chutney
     ! less spicy
1  Dal Makhani (Half)
--------------------------------
```
Change slips: header `MODIFIED KOT 0042` / `CANCELLED`, lines `+1 Paneer Tikka`, `-1 Dal Makhani`, reason.
Move notice: `MOVED T4 → T9`. Reprints: `** DUPLICATE **`.
Online orders (P4-06): the KOT and the bill print the order's reference under the header, e.g.
`W-1042 · DELIVERY · CASH ON DELIVERY` (stored with the document; reprints match). Charge lines never go on a KOT.
Built in P2-04: every ticket (new, modify, cancel) is stored as printed in `kot_document` (append-only) and a
reprint renders that copy. Change slips print `-1 Butter Naan`, `now 2`, `Changes KOT 0041` and `Reason: …`. A long
title wraps instead of being cut on 58 mm double-width (`CANCELLED KOT` / `0043`).

### Bill
Outlet name, address, GSTIN, FSSAI no.; bill no., date/time, table, covers, captain, cashier; lines with
qty × rate = amount; subtotal; discount (with reason code); service charge (only if guest accepted); CGST
and SGST with rates; round-off; grand total; payment QR (UPI intent `upi://pay?pa=...&am=...&tn=Bill 1234`);
footer text. Split parts print "Part 2 of 3". Reprints print DUPLICATE.

Built in P1-07 (`packages/printing/src/templates/bill.ts`): the template only lays out figures from
`calculateBill`. 80 mm uses Item/Qty/Rate/Amount columns; 58 mm puts `qty x rate  amount` under the name. A
line that does not fit is wrapped, never cut (bill numbers, GSTINs). Text mode has no ₹ glyph, so amounts
print as `Rs 1,680.00`; Hindi/Bengali bitmap lines are still to do (`bitmap-text.ts`). Not yet verified on a
physical printer.

Bill design (P2-12, from TiffinPOS; `BillDocument.display`, stored with each bill so a reprint looks the same):
optional logo, printed first as a 1-bit raster (`GS v 0`, at most 384 × 240 dots, centred; the preview shows
`[logo]`); name in large or normal size; up to 2 lines under the name; show or hide phone, table/area, covers,
captain, cashier, guest name/phone, the Rate column (`qty x rate` on 58 mm), free add-ons, "on <taxable>" after
GST lines, and an "Items n / Qty m" line. Never optional: outlet name, address, GSTIN, FSSAI, TAX INVOICE, bill
number, date/time, every tax line, round-off, total, a guest GSTIN, priced add-ons. Defaults print the standard
bill byte for byte.

### Z-report (day-end)
Sales by mode, by area, by category; discounts; voids; cancelled-after-fire count; cash expected vs counted.

## Worker
1. One worker per printer (`apps/server/src/print/print-queue.ts`), woken after each command commits; it takes
   the oldest `queued`/`retry` job. Order is strict: a job waiting out a backoff holds back the next one.
2. Send bytes (× `copies`). TCP: connect, write, end; the job counts as printed once every byte is flushed and
   the printer did not reset the connection within 1.5 s (many printers never close their side, so waiting for
   `close` alone would reprint every ticket). Connect + flush must finish within 5 s. USB: Windows RAW spool via
   winspool.drv from a constant PowerShell 5.1 script (printer name in an env var, bytes on stdin).
3. Success → `state='done'`. Failure → attempts++, backoff 2 s / 5 s / 15 s (so 1 try + 3 retries), then
   `state='failed'`. `print.status` `{ printerId, status: retrying|offline|ok, queued, error }` is emitted on the
   first failure (`retrying`), on giving up (`offline`) and on the first success after trouble (`ok`). If
   `backupPrinterId`, a copy is queued there with header `** REROUTED FROM <name> **` (audited as
   `print.reroute`); a rerouted job is never rerouted again.
4. On server start: resume `queued`/`retry` jobs. On stop: cancel backoff timers, finish the ticket being sent.
   `GET /v1/printers` shows each printer's status, queued count and last error.
5. Printer status between tickets (`PrintQueue.startMonitor`, every 30 s): a printer with no jobs waiting is checked
   without printing (`Transport.probe`). Network: a TCP connection opened and closed (nothing sent). USB: Windows'
   view of the queue (`PROBE_SCRIPT`: queue missing, device unplugged, offline, out of paper, cover open, jammed).
   A change (down with the reason, or back) is a `print.status` event like a job's, so the top bar turns red
   without waiting for a failed print. When the check itself cannot run, nothing is reported (no false alarm).
   Optional later: ESC/POS status poll (DLE EOT 4) for paper-end on network printers.

## Fake printer (dev)
`transport: fake` writes a rendered text preview to `data/prints/<printerId>/<jobId>.txt` and logs it. Tests
assert on the text preview, not raw bytes.

## KDS
- PWA at `/kds?station=<id>`; subscribes to `station:<id>`.
- Columns: New → Ready. Ticket shows KOT no., table, age timer (amber ≥ 10 min, red ≥ 20 min; configurable),
  items with notes, course.
- Bump → `MarkKotReady`. Second bump (or captain) → `MarkKotServed`.
- Side panel: all-day counts per item across open tickets.

Built in P4-02 (`apps/kds`, served at `/kds`; shell shared with the captain app in `packages/web-shell`):
- Pair the screen (kind `kds`) and choose the station (`?station=<id>` in the address wins, else the saved choice;
  stations marked for a screen first). No sign-in after pairing: a paired kitchen screen (and the master PC itself)
  has the `kds.bump` right on its own and nothing else (`DEVICE_RIGHTS`); its bumps are audited with the device.
- `GET /v1/kds/tickets?stationId=` (`apps/server/src/queries/kds.ts`): the station's KOTs of the business day not
  yet served, oldest first, exactly as printed (`kot_document`) plus `firedAt`/`readyAt`; tickets of settled or
  void orders drop off. Change slips (CHANGED / CANCELLED, with the KOT they change and the reason) and move
  notices show too; a change slip sits on its original ticket while that is on the screen, and one bump acts on
  both. The screen listens to the `kds` topic and refetches (the whole board after a reconnect); a short chime on a
  new ticket.
- Columns New → Ready, plus All day (still to cook; a change slip's `-1` takes one off). Age as m:ss on the
  server's clock, amber/red at `kds.amberMin` / `kds.redMin` (10 / 20 by default; Settings › Kitchen & printers).
- `MarkKotReady` (first bump), `MarkKotServed` (second bump; sets ready too if it was skipped), `RecallKot` (undo a
  bump: back to New; "Undo" after Served). Right `kds.bump`; they change only the KOT's timestamps, never the order's
  version, so the kitchen never conflicts with a captain or a terminal. Audited `kot.ready` / `kot.served` /
  `kot.recall`; `kot.status` on `station:<id>`, `order:<id>` and `kds`.
- Report **Kitchen speed** (Reports › Kitchen): per station, tickets bumped, average and slowest KOT → ready, how
  many took longer than the amber time, on-time share, tickets served, average wait at the pass (ready → served),
  tickets never bumped. Also in Reports › Kitchen: **Kitchen by hour** (tickets sent / bumped / served, average and
  slowest to ready, late, per hour the KOT was sent), **Dish prep times** (per dish and station: quantity, tickets,
  average and slowest to ready of the tickets it was on, late; slowest first) and **Kitchen ticket log** (every KOT:
  sent, station, table, dishes, to ready, at the pass, sent to served, status).
- The screen's header shows the station's day: **Served today n**, average KOT → ready, and how many were late
  (`KdsBoard.today`).

### DinePOS Kitchen (Windows app for a kitchen PC, `apps/kitchen`)
- An installer (`npm run dist -w @dinepos/kitchen` → `apps/kitchen/release/DinePOS-Kitchen-Setup-<version>.exe`) that
  opens the server's `/kds` full screen (kiosk). It copies nothing of the display: the server's page is always the one shown.
- Asks for the main PC's address once (checked with `GET /v1/health`), starts with Windows (can be switched off), keeps
  the screen awake, plays the chime without a tap, and retries every 10 s while the server is not reachable.
- The window shows only that server's pages and its own setup page; other sites and new windows are refused, all
  permission requests denied. Keys: Ctrl+Shift+S setup · F5 reload · Ctrl+Shift+M minimize (full screen again when restored) · Ctrl+Shift+Q close.
- Pairing and station choice are the display's own (as in a browser): approve the code in Settings › Devices.

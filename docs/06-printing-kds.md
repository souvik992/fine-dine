# 06 — Printing and KDS

Printing is a durable queue. Render bytes inside the command transaction (as `print_job` rows), send after
commit, retry until confirmed.

## Station routing
- Each `MenuItem` has a default `stationId`; a `Category` can set one for all its items; an `Area` can
  override per category (e.g. Bar area sends mocktails to the bar counter).
- Resolution order: area override → item → category → outlet default station.
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

### Bill
Outlet name, address, GSTIN, FSSAI no.; bill no., date/time, table, covers, captain, cashier; lines with
qty × rate = amount; subtotal; discount (with reason code); service charge (only if guest accepted); CGST
and SGST with rates; round-off; grand total; payment QR (UPI intent `upi://pay?pa=...&am=...&tn=Bill 1234`);
footer text. Split parts print "Part 2 of 3". Reprints print DUPLICATE.

### Z-report (day-end)
Sales by mode, by area, by category; discounts; voids; cancelled-after-fire count; cash expected vs counted.

## Worker
1. One worker per printer; polls `print_job` where `state in ('queued','retry')` ordered by created_at.
2. Send bytes. TCP: open socket, write, end, await 'close' (timeout 5 s). USB: Windows RAW spool.
3. Success → `state='done'`. Failure → attempts++, backoff 2 s / 5 s / 15 s, then `state='failed'`, emit
   `print.status` offline; if `backupPrinterId`, enqueue copy there with header `REROUTED FROM <name>`.
4. On server start: resume `queued`/`retry` jobs.
5. Optional status poll (DLE EOT 4) for paper-end where supported.

## Fake printer (dev)
`transport: fake` writes a rendered text preview to `data/prints/<printer>/<jobId>.txt` and logs it. Tests
assert on the text preview, not raw bytes.

## KDS
- PWA at `/kds?station=<id>`; subscribes to `station:<id>`.
- Columns: New → Ready. Ticket shows KOT no., table, age timer (amber ≥ 10 min, red ≥ 20 min; configurable),
  items with notes, course.
- Bump → `MarkKotReady`. Second bump (or captain) → `MarkKotServed`.
- Side panel: all-day counts per item across open tickets.

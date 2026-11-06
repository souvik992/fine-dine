# Capacity (measured)

`npm run load-test` (scripts/load-test.mjs) starts a real outlet server with the demo menu and runs whole orders through
it. Each order is OpenTable → AddItems → FireKOT → AddItems → FireKOT → PrintBill → Settle, 7 commands. Meanwhile a
captain phone refreshes the floor every 500 ms. Measured 2026-11-07 on the development laptop (Windows 11), server run
from source.

| Run | Result |
|---|---|
| 1000 orders, 8 terminals working non-stop (no pause between taps) | 99 s, **0 errors**, 71 commands/s ≈ **36,000 orders an hour**. Each command takes 97–125 ms (median); most of that is waiting behind the other seven terminals |
| 300 orders, 1 terminal (normal pace) | Each command takes **17 ms** (median), **30 ms** (95th percentile), 47 ms (99th); the floor refresh takes 20 ms |
| Installed server bundle, idle | **81 MB** of memory |

**What this means for a busy outlet.** 1000 orders a day with a 150-orders-an-hour rush is about 0.3 commands a second.
The server can do over 50 a second, so a busy outlet uses well under 1% of it.

## Storage per order

| Table | Per order | Kept |
|---|---|---|
| processed_command (replay protection) | 20 KB | 7 days (day end) |
| event_log (live updates) | 8 KB | the last 10,000 events (day end) |
| print_job (ticket bytes) | 8 KB | 30 days, then the bytes are dropped and the record kept (day end) |
| bill_document, audit_event, kot_document, order_item, stock and the rest | about 11 KB | always (the legal and audit record) |

At 1000 orders a day this comes to:
- the permanent record: about 11 MB a day, roughly 4 GB a year;
- the rolling tables: steady at about 0.4 GB.

Plan the disk for that, and check how long backups take as the database grows.

## DinePOS Cloud

- **Hosted outlets:** about 80–150 MB of memory each. That's about 5 on a 1 GB server, 12 on 2 GB and 25–30 on 4 GB.
- **Outlets with a main PC:** one connection each plus small messages; hundreds per small server.

Run the load test again after large changes, and before you move many outlets onto one server.

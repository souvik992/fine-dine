# @dinepos/kds — kitchen display (PWA)

Served at `/kds?station=<id>`, runs on a wall-mounted tablet or small PC in kiosk mode.

Read first: `docs/06-printing-kds.md` (KDS section), `docs/04-realtime-events.md`.

## Behaviour
- Subscribes to `station:<id>`; replays from last seq on reconnect.
- Columns: New, Ready. Ticket = KOT no., table, course, captain, items with notes, age timer.
- Age colours: amber ≥ 10 min, red ≥ 20 min (configurable).
- Tap bump → `MarkKotReady`; bump again → `MarkKotServed`.
- Modify/cancel KOTs appear highlighted and attach to the original ticket.
- Sidebar: all-day counts by item.
- Dark theme by default, very large type, no login after pairing (device token only).

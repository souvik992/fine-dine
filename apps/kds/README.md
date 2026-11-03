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

## Built (P4-02)
- Pair → choose the station (`?station=` wins, else the saved choice) → the board. No sign-in: the server gives a
  paired `kds` device the `kds.bump` right only (`DEVICE_RIGHTS`, `apps/server/src/core/rights.ts`); bumps are audited
  with the device. The master PC opening `/kds` itself works the same way.
- Listens to the `kds` topic (every station) and refetches `GET /v1/kds/tickets?stationId=`; on reconnect the whole
  board is refetched (instead of replaying events). A short chime when a new ticket arrives.
- Change slips sit on their original ticket (CHANGED / CANCELLED band, `-1`, "now 1", reason); one bump acts on the
  ticket and its slips. A slip whose original already went out is a card of its own ("Seen").
- Ready tickets keep the age they had when bumped; "Back to New" on a ready ticket, "Undo" after Served
  (`RecallKot`).
- Thresholds: Settings › Kitchen & printers on a terminal (`kds.amberMin`, `kds.redMin`), which also shows the
  address to open.

## Code
- `src/kds-model.ts` (pure, tested): ages on the server clock, amber/red, cards with attached slips, columns, courses,
  all-day counts.
- `src/screens/KdsScreen.tsx` (the board), `StationPicker.tsx`; `src/main.tsx` holds the shell settings (no idle lock).
- Pairing and the stream come from `@dinepos/web-shell`.

## Build and run
- `npm run build -w @dinepos/kds` → `dist/`, served at `/kds` (installer: `resources/server/web/kds`).
- `npm run dev -w @dinepos/kds` serves it on :5175 with the API proxied to :7420.
- End-to-end test: `apps/desktop/e2e/kds.e2e.test.ts`.

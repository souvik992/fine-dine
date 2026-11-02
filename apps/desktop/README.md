# @dinepos/desktop — billing app (Electron)

The terminal UI for cashiers/managers: floor, billing, settle, split, reports, settings. It is **only a
client** of the outlet server — it never opens the database, even on the master PC.

Read first: `docs/09-ui-screens.md`, `docs/03-command-api.md`, `docs/04-realtime-events.md`,
`docs/05-sync-offline.md` (outbox + conflict UX).

## Stack
Electron 45 main process (no preload yet) · React 19 + Vite 8 + Tailwind 4 (renderer) · TanStack Query for
GETs · a small `api` client that builds command envelopes · types and helpers from `@dinepos/shared`. Zustand
and a preload bridge arrive when the offline outbox needs them (P2-07/P3-03).

## Security (P1-08)
The renderer is our own bundle served on `app://dinepos` with a strict CSP (`script-src 'self'`, connect only
to http/ws). `contextIsolation`, `sandbox`, no `nodeIntegration`, no webviews, no navigation away from the app,
no new windows (https links open in the browser), all permission requests denied, single instance. The
renderer calls the outlet server directly; the server allows the `app://dinepos` origin via CORS and on the
WebSocket upgrade. Verified on Electron 45 against both `127.0.0.1` and a LAN IP.

## Folder plan
```
electron/
  main.ts          window, auto-update (later), settings file, offline outbox file
  preload.ts       expose a minimal, typed bridge (no Node in renderer)
src/
  api/client.ts    sendCommand(type, payload, {orderId, expectedVersion}) with retry + commandId reuse
  api/stream.ts    WS with resumeFrom, heartbeat, reconnect backoff
  api/outbox.ts    offline queue (via preload → main process file)
  screens/Floor/, Order/, Settle/, SplitBill/, Reports/, Settings/, Leakage/
  components/      TableTile, ItemGrid, ModifierSheet, Cart, Keypad, ConflictBanner, HealthDots
  hooks/useKeyboardShortcuts.ts
  theme/tokens.css design tokens from docs/09
```

## Conflict handling
`VERSION_CONFLICT` → if command is "safe" (see `docs/05-sync-offline.md`) resend with the returned
version; otherwise show `ConflictBanner` with what changed and who did it.

## Dev
- `npm run dev -w @dinepos/desktop`: Vite dev server with hot reload + Electron. The server must be running
  (`npm run dev:server`, then `npm run seed -w @dinepos/server` once).
- `npm run start -w @dinepos/desktop`: production build (`dist-renderer/`, `dist-electron/`) and launch.
- Server address: Settings (gear icon) → "Test connection" → "Save and connect". Default `http://127.0.0.1:7420`;
  `DINEPOS_SERVER_URL` preselects one for a session (installer, tests). File → New window (Ctrl+N) opens a
  second window on the same terminal.
- Tests: `npm run test` (unit, from the repo root). `npm run test:e2e -w @dinepos/desktop` builds the app and drives
  the real Electron window against a real server process (needs a desktop session; not run in CI).
- VS Code terminals set `ELECTRON_RUN_AS_NODE=1`; the scripts remove it.

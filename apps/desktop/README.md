# @dinepos/desktop — billing app (Electron)

The terminal UI for cashiers/managers: floor, billing, settle, split, reports, settings. It is **only a
client** of the outlet server — it never opens the database, even on the master PC.

Read first: `docs/09-ui-screens.md`, `docs/03-command-api.md`, `docs/04-realtime-events.md`,
`docs/05-sync-offline.md` (outbox + conflict UX).

## Stack
Electron (main + preload) · React 18 + Vite (renderer) · TanStack Query for GETs · a small `api` client
that builds command envelopes · Zustand for UI state · zod schemas from `@dinepos/shared`.

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
`npm run dev -w @dinepos/desktop` (after P1-08). Point it to `http://127.0.0.1:7420` in Settings.

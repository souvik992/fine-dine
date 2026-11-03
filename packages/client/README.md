# @dinepos/client

Browser clients for the outlet server, shared by the desktop terminal, the captain app and (later) the KDS:
- `ApiClient`: GETs and commands with network retries on the same `commandId`, the session and device tokens
  (`X-User-Session`, `Authorization: Device …`), manager PIN prompts (`PIN_REQUIRED` → resend), and callbacks when
  the session ends or the device is not paired.
- `StreamClient`: the `/v1/stream` WebSocket (hello with resume, heartbeat, backoff, device token, 4401/4403).

- Order taking (`src/order/`, moved from the desktop in P3-02): `OrderSession` (one command queue per order, silent
  rebase for cart commands, conflicts explained), `addOrMerge` / `changeBy` (which cart command a tap becomes) and the
  menu helpers (search, quick entry, option sheet rules, KOT grouping). Tests next to them.

API/stream tests live with the desktop (`apps/desktop/src/api/api.test.ts`), which re-exports this package.

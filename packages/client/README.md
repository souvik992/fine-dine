# @dinepos/client

Browser clients for the outlet server, shared by the desktop terminal, the captain app and (later) the KDS:
- `ApiClient`: GETs and commands with network retries on the same `commandId`, the session and device tokens
  (`X-User-Session`, `Authorization: Device …`), manager PIN prompts (`PIN_REQUIRED` → resend), and callbacks when
  the session ends or the device is not paired.
- `StreamClient`: the `/v1/stream` WebSocket (hello with resume, heartbeat, backoff, device token, 4401/4403).

Tests live with the desktop (`apps/desktop/src/api/api.test.ts`), which re-exports this package.

# 04 — Real-time events

Endpoint: `GET /v1/stream` (WebSocket). Auth: first message `{ "type": "hello", "deviceToken": "...",
"resumeFrom": <seq|null>, "topics": ["floor", "station:tandoor"] }`.

## Message format
```json
{ "seq": 10423, "topic": "floor", "event": "table.state", "at": "2026-11-02T20:14:06+05:30", "data": { } }
```
`seq` is outlet-wide and strictly increasing (it is `event_log.seq`).

## Topics and events
| Event | Topic(s) | data | Consumers |
| --- | --- | --- | --- |
| `order.updated` | `order:<id>`, `floor` | orderId, version, tableId, state, totals | desktop, captain |
| `table.state` | `floor` | tableId, state, since, amountPaise, captainId | desktop, captain |
| `kot.created` | `station:<id>`, `kds` | kot (full ticket incl. items, notes, course) | KDS |
| `kot.status` | `station:<id>`, `order:<id>` | kotId, status | captain, desktop |
| `print.status` | `printers` | printerId, status (`retrying` \| `offline` \| `ok`), queued, error | desktop |
| `menu.changed` | `menu` | menuVersion, itemIds | all |
| `floor.changed` | `floor` | areaId?, tableId? (layout/config changed; refetch `/v1/floor`) | desktop, captain |
| `printer.changed` | `printers` | printerId | desktop |
| `online.order` | `online` | orderId, source | desktop (Phase 4) |
| `day.changed` | `system` | businessDate | all |
| `license.warning` | `system` | daysLeft | desktop |

## Protocol details (built in P1-08, `apps/server/src/realtime/hub.ts`)
- Topics: exact (`floor`, `station:<id>`) or prefix wildcard (`order:*`). Up to 50 per connection.
- After `hello` the server answers `{ "type": "ready", "lastSeq", "replayed" }` (after any replay) or
  `{ "type": "resync", "lastSeq" }`. With `resumeFrom: null` there is no replay; the client starts at `lastSeq`.
- The hub subscribes to live events before reading `event_log`, buffers them during replay and drops any
  `seq` already replayed, so a reconnect never loses or repeats an event.
- Heartbeat: every 15 s a WS ping plus `{ "type": "heartbeat", "lastSeq", "at" }` (browsers cannot see pings).
  The desktop client goes offline after 35 s without any message and reconnects (0.5/1/2/5/10 s backoff).
- Close codes: 4400 bad hello, 4408 no hello within 10 s, 4429 client too slow (>1 MB queued; reconnect and
  resume), 1001 server stopping.
- Browser `Origin` must be in `DINEPOS_ALLOWED_ORIGINS` (default `app://dinepos` and the Vite dev server) or the
  server's own host (captain/KDS PWAs); otherwise 403 before the upgrade. The same list drives CORS.

## Rules
1. Events are written to `event_log` inside the command transaction and broadcast after commit.
2. On connect with `resumeFrom`, the server replays events with `seq > resumeFrom` for the requested topics,
   then streams live. If `resumeFrom` is older than the oldest retained event, server sends
   `{ "type": "resync" }` and the client refetches via GET.
3. Retain the last 10,000 events (prune at day-end).
4. Heartbeat: server pings every 15 s. Client treats 2 missed pongs as offline.
5. Clients render from snapshots/GETs; events are triggers, not the source of truth for money.

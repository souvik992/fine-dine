# 05 — Concurrency, offline and sync

## Optimistic concurrency
- `order.version` starts at 1 and increments by 1 for every accepted command on that order.
- Client sends `expectedVersion`. Mismatch → `VERSION_CONFLICT` with the current snapshot.
- Client auto-retry policy:
  | Command | On conflict |
  | --- | --- |
  | AddItems, FireKOT (new items), SetCovers, UpdateHeldItem, RemoveHeldItem | rebase silently: resend with new version (same commandId; up to 5 times while other devices keep changing the order, P3-02). Held-item edits are included because the server still refuses them with INVALID_STATE if the item was fired meanwhile |
  | MoveTable, MergeTables, TransferItems, PrintBill, SplitBill, Settle, Void, Cancel/Modify fired | show "Table changed by <user>" and ask |

Built in P2-07:
- `VERSION_CONFLICT` says who changed the order last and how: `details.lastChange { by, what, at }` (from the audit
  rows of the order, its items, bills and KOTs) and a message such as "Table T5 was changed by Ravi (moved the table)
  at 20:14. Check the order and try again." (`apps/server/src/core/conflict.ts`).
- A decision made in a dialog (print bill, settle, split, move, merge, move items, change or cancel a sent item) is
  sent on the version shown **when the dialog opened** (`OrderSession.holdDecision`): a change made on another terminal
  meanwhile is refused and explained, never silently included, even though the screen already updated from the stream.
  After the refusal the dialog decides on what is now shown, so trying again works.
- The order screen shows a red banner: "The bill was not printed. Table T5 was changed by … Check the order and try
  again." with "OK, I have checked". Rebased commands (adding, sending, held-item edits) never show it.
- Acceptance: two terminals that only see their own changes add 20 items each to one table and all 40 arrive once;
  two windows punching the same table at the same moment lose nothing; Move vs Print bill shows the banner and prints
  nothing (unit, server and end-to-end tests).

## Idempotency
- Every command has a client-made `commandId` (ULID).
- `processed_command(command_id, result_json, at)` written in the same transaction.
- Replays return the stored result with `DUPLICATE`. Keep 7 days; prune at day-end.
- `result_json` stores `{ type, requestHash, response }`; `requestHash` is SHA-256 of the canonical
  (sorted-key) `{type, orderId, expectedVersion, payload}`, so a retry with reordered keys still matches.
- Only committed commands are recorded: a command that failed (validation, conflict, handler error) leaves
  no row, and its retry runs again.

## Client offline outbox (desktop terminals and captain)
1. Health check: WS heartbeat + `GET /v1/health` every 10 s when WS is down.
2. Offline → commands are appended to a local outbox (IndexedDB in PWA, a small local file/SQLite in
   Electron main process — never the master DB).
3. Allowed offline: OpenTable (temp id), AddItems, UpdateHeldItem, RemoveHeldItem, FireKOT (marked
   "queued — not in kitchen").
4. Blocked offline (button disabled with reason): PrintBill, SplitBill, Settle, Void, Cancel/Modify fired,
   Move/Merge/Transfer, DayEnd.
5. Reconnect: replay in order. Each command keeps its `commandId`. Conflicts surface in a "Needs attention"
   list.
6. Temp ids: OpenTable offline makes an order id on the client (ULID). The server accepts client-made order
   ids for `OpenTable` if the table is still free; otherwise returns `INVALID_STATE` and the captain picks
   another table.

Built in P3-03 (captain app; the desktop terminals still need the server, see below):
- Every change from the phone goes through the outbox (`packages/client/src/outbox/outbox.ts`), online too: stored in
  IndexedDB (`apps/captain/src/offline/idb.ts`), sent at once when the server answers, otherwise replayed when the
  stream is live again and every 10 s while anything waits. Strictly first-in first-out; one replay at a time.
- Each queued command keeps its `commandId`, its `expectedVersion` (the version the phone predicted: the server's plus
  one per change already waiting) and the session of the captain who made it, so a lost answer is answered
  `DUPLICATE` and the change is credited to the right person even if someone else signed in on the phone.
- `VERSION_CONFLICT` → rebased silently on the newer snapshot (up to 5 times): a quantity change keeps its difference
  (+2 stays +2 if the terminal changed the line meanwhile; below 1 becomes a removal), a fire keeps only the dishes
  still waiting (none left → skipped), a change to a line removed elsewhere is skipped.
- Fire from the phone names the dishes the captain saw (`{ itemIds }`), so dishes added meanwhile at a terminal are
  not sent with it. Fired offline: shown as "Queued — not in the kitchen yet" and treated as sent for later taps.
- Refused after waiting offline → **Needs attention** (who, what, when, the server's reason). Later changes to that
  order wait behind it. Actions: Try again (as the captain signed in now), Discard (with the changes that need it), and
  for a table taken meanwhile, Seat at another table (same order id, so its dishes follow). Refused while online →
  shown at once as a message and dropped with the changes that depended on it.
- The phone shows what it last saw when offline: floor, menu and orders are kept in IndexedDB; tables seated offline
  show as seated; dish names, prices and totals of waiting lines come from the cached menu and the shared bill
  calculator. SetCovers needs the server (disabled offline with the reason); signing in needs it too.
- Limits: the service worker only runs on a secure origin (https, or the master PC itself), so on a phone opening
  `http://<lan-ip>:7420/captain` a reload with no connection cannot open the app; queued changes stay in IndexedDB and
  go out when it opens again. Desktop terminals have no outbox yet (they are usually wired to the master).

## Numbering
| Number | Assigned by | Scope | Where |
| --- | --- | --- | --- |
| Bill no. | server | per FY (Apr–Mar), gap-free | `counter` row `bill_no:<fy>` inside `PrintBill` |
| KOT no. | server | per business date | `counter` row `kot_no:<date>` |
| Token no. (takeaway) | server | per business date | `counter` |

## Master failure
- UPS required. `synchronous=FULL`.
- Windows service auto-restarts; on start: `PRAGMA quick_check`, resume print queue, resume sync.
- Dead hardware: restore latest backup on another PC, run "Promote to master" (manager PIN); clients
  re-discover via mDNS or new IP. Never run two masters.

## Cloud sync (P4-05)
The "cloud" is the order hub (pos-backend `hub/`, `src/sync.ts`); the outlet uses the **same pairing** as online
orders (Settings › Online orders), so one connection link sets up both. The agent is `apps/server/src/sync/sync-agent.ts`.
- **Up.** The outbox (`day.closed`, `bill.printed`, `bill.settled`, `bill.voided`; bill payloads carry `businessDate`;
  `bill.printed` also carries the order type, channel, terminal, covers, tax, discount and the items with their
  category, for the portal's Analytics page: `apps/server/src/commands/sales-facts.ts`)
  is sent in `seq` order: `POST {hub}/v1/pos/sync/batches` `{streamId, fromSeq, events[{seq, kind, payload, createdAt}]}`,
  at most 200 rows / ~1 MB per batch, authenticated with the hub device key (Bearer). The licence key is public, so it
  is not used to authenticate. The hub answers `{ackSeq}` (the highest seq it holds); `RecordSyncAck` marks those rows
  `sent_at`. Sent on start, ~1 s after any committed command, every 30 s, and on Settings › Cloud sync › Sync now.
- **Streams.** Each outlet database has its own `sync_state.stream_id` (migration 0013); the hub keeps (store, stream,
  seq). Resending is harmless (same seq, same content). Hub answers:
  `SYNC_GAP {ackSeq}` (the hub lost records, e.g. restored) → `RecordSyncAck` with `rewind` and send again (≤ 3 per run);
  `SYNC_CONFLICT` (different content under a seq it holds: this database was restored or copied) → the agent stops and
  Settings shows **Start a new sync stream** (`ResetSyncStream`, admin): unsent rows go up under the new stream; nothing
  is deleted on either side. The hub's sales view counts each bill id and each business day once.
- **Down: licence renewals.** The vendor pastes a renewed key on the hub's store page; the agent fetches
  `GET /v1/pos/licence` hourly (and on Sync now) and runs `RenewLicence`, which installs it only if it is genuine, for
  this PC and ends later. The result is shown in Settings › Cloud sync.
- **Down: menu documents — not done, on purpose.** The menu is owned and edited on the outlet (DinePOS publishes it to
  the hub for online orders, P4-06); the hub has no menu editor, so there is nothing to bring down. Revisit with a
  multi-outlet head-office menu. Online orders come down over the P4-06 event stream.
- **Status:** `GET /v1/sync` (state idle / sending / offline / stuck / not-paired, rows waiting, last sent, last error,
  licence check); `POST /v1/sync/run` (admin).
- The hub is never required for billing: while it cannot be reached the outbox only grows (`idx_outbox_unsent`).

## Online orders through the order hub (P4-06)
The hub (`pos-backend/hub`, contract v1 in `pos-backend/contract`) owns online orders and their states; DinePOS owns the
menu, prices, bill and bill number. `apps/server/src/online/connector.ts` (started by the server; idle unless online
orders are on and the outlet is paired):
- One outgoing SSE stream (`GET /v1/pos/events`, `Last-Event-ID` = `online_link.last_seq`). Each event is applied by
  `ApplyHubEvent`, which stores the order *and* the new resume point in one transaction; an event at or below it is
  ignored (at-least-once delivery, F1, F4). Silence for 3 heartbeats (45 s) reconnects (1/2/5/10/30 s backoff).
- An outbox (`online_outbox`): `received`, `accept`, `reject`, `state`, each with its idempotency key (`rcv-<id>`,
  `acc-<id>`, `rej-<id>`, `st-<id>-<state>`), written in the same transaction as the change and sent after commit, in
  order, retried until the hub answers (F2, F3). A 409/404/400 is final; an accept refused because the customer cancelled
  first leaves the order cancelled with a note to void its bill (F11).
- Publishes the menu when its hash changes (`PUT /v1/pos/menu`, version + 1) and `PUT /v1/pos/status { accepting }`
  (online on + paired + a business day open). The outlet never accepts incoming connections; billing never waits for
  the hub.

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

## Cloud sync (Phase 4)
- Up: sync agent drains `outbox` by `seq` → `POST {cloud}/sync/batches` `{outletId, fromSeq, events[]}`,
  signed with the licence key. Cloud acks highest seq; agent marks `sent_at`.
- Down: long-poll/WS from cloud for menu documents (versioned), licence renewals, online orders.
  Applied on the master as normal commands (audited).
- Cloud is never required for billing.

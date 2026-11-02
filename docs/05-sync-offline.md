# 05 — Concurrency, offline and sync

## Optimistic concurrency
- `order.version` starts at 1 and increments by 1 for every accepted command on that order.
- Client sends `expectedVersion`. Mismatch → `VERSION_CONFLICT` with the current snapshot.
- Client auto-retry policy:
  | Command | On conflict |
  | --- | --- |
  | AddItems, FireKOT (new items), SetCovers | rebase silently: resend with new version |
  | MoveTable, MergeTables, TransferItems, PrintBill, SplitBill, Settle, Void, Cancel/Modify fired | show "Table changed by <user>" and ask |

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

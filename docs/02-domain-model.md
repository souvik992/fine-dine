# 02 — Domain model

## Entities
| Entity | Key fields | Notes |
| --- | --- | --- |
| Area | id, name, priceListId, taxProfileId | Per-area pricing and tax |
| DiningTable | id, areaId, label, seats, layoutX, layoutY, status(active/reserved/blocked), openOrderId | One open order max |
| Order | id, businessDate, tableId?, type, covers, captainId, state, version, mergedInto, timestamps | Aggregate root |
| OrderItem | id, orderId, itemId, variantId, nameSnapshot, qty, unitPricePaise, taxRateBp, note, course, stationId, kotId, status | Snapshots at add time |
| OrderItemAddon | orderItemId, addonId, nameSnapshot, qty, pricePaise | |
| Kot | id, orderId, stationId, businessDate, kotNo, kind, firedAt, readyAt, servedAt, reprintCount | kind: new/modify/cancel/move_notice |
| Bill | id, orderId, fy, billNo, splitNo, amounts…, state | One per split part |
| Payment | id, billId, mode, amountPaise, ref | |
| AuditEvent | seq, ts, deviceId, userId, commandId, entity, entityId, action, before, after, reason, leakageFlag | Append-only |

Menu: Category, MenuItem (vegFlag, shortCode, stationId, taxRateBp, available), Variant, AddonGroup (min/max),
Addon, PriceList + PriceListEntry (areaId-specific price overrides).
People: User, Role, RolePermission, Device.

## Order state machine
```
            OpenTable / NewTakeaway
                     │
                     ▼
   ┌──────────────► open ──────── PrintBill ───────► billed
   │                 │  ▲                              │
   │   AddItems,     │  └──── AddItems/FireKOT ────────┤   (adding a round after print
   │   FireKOT ...   │                                 │    returns order to open; bill
   │                 │                                 │    is superseded, reprint later)
   │          MergeTables(source)                 Settle (all parts paid)
   │                 ▼                                 ▼
   │              merged                            settled
   │                                                   │
   └───────── (never reopened)            VoidBill ─────► void (reversal entries)
```

## Derived table state (`deriveTableState`)
| Order of checks | Condition | State |
| --- | --- | --- |
| 1 | table.status = blocked | `BLOCKED` |
| 2 | table.status = reserved and no open order | `RESERVED` |
| 3 | no open order | `FREE` |
| 4 | order has no fired KOT | `SEATED` |
| 5 | billPrintedAt is null or lastKotAt > billPrintedAt | `KOT_RUNNING` |
| 6 | otherwise | `BILL_PRINTED` |

## Order item states
`held` → (FireKOT) → `fired` → (CancelFiredItem) → `cancelled`.
`held` items can be edited/removed freely (audited but not flagged). Fired items change only through
`ModifyFiredItem` / `CancelFiredItem`, which create `modify`/`cancel` KOTs and set leakage flags.

## Invariants (enforce in code + tests)
1. A table has at most one order in state `open` or `billed` (`dining_table.open_order_id` UNIQUE).
2. `order.version` increases by exactly 1 per accepted command touching the order.
3. Sum of bill parts' totals = order total (split must allocate every paisa; remainder goes to the last part).
4. Settled bills are immutable; changes after settle are `VoidBill` + new order.
5. Bill numbers are gap-free and unique per FY; KOT numbers unique per business date.
6. `audit_event` rows are never updated or deleted (DB triggers enforce).
7. Fired items keep their KOT link forever; moving items to another order keeps the original KOT history.
8. No floats for money anywhere.

## Leakage flags (set on audit_event.leakage_flag = 1)
- Cancel of a fired item
- Modify of a fired item (qty down / replace)
- KOT reprint, bill reprint
- Transfer of items / move table after a KOT exists
- Void bill
- Discount above the role's threshold
- At day-end: any fired KOT with no billed item (computed report, not an event)

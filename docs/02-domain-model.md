# 02 — Domain model

## Entities
| Entity | Key fields | Notes |
| --- | --- | --- |
| Area | id, name, priceListId, taxProfileId | Per-area pricing and tax |
| DiningTable | id, areaId, label, seats, layoutX, layoutY, status(active/reserved/blocked), openOrderId | One open order max |
| Order | id, businessDate, tableId?, type, covers, captainId, state, version, mergedInto, timestamps | Aggregate root |
| CaptainSection | userId, areaId \| tableId | P3-04: who looks after which area/table (`captain_section`) |
| BillRequest | orderId, requestedAt, requestedBy | P3-04: open "Request bill", cleared by PrintBill (`bill_request`) |
| Reservation | id, guestName, phone?, partySize, startsAt (UTC), durationMin, tableIds[], note?, status(booked/seated/cancelled/no_show), orderId? | P4-04 (`reservation`, `reservation_table`); never deleted |
| WaitlistEntry | id, guestName, phone?, partySize, quotedMin?, status(waiting/seated/left/cancelled), joinedAt, tableId?, orderId? | P4-04 (`waitlist_entry`) |
| OrderItem | id, orderId, itemId, variantId, nameSnapshot, qty, unitPricePaise, taxRateBp, note, course, stationId, kotId, status | Snapshots at add time |
| OrderItemAddon | orderItemId, addonId, nameSnapshot, qty, pricePaise | |
| Kot | id, orderId, stationId, businessDate, kotNo, kind, firedAt, readyAt, servedAt, reprintCount | kind: new/modify/cancel/move_notice |
| Bill | id, orderId, fy, billNo, splitNo, amounts…, state | One per split part |
| Payment | id, billId, mode, amountPaise, ref | |
| AuditEvent | seq, ts, deviceId, userId, commandId, entity, entityId, action, before, after, reason, leakageFlag | Append-only |

Menu: Category, MenuItem (vegFlag, shortCode, stationId, taxRateBp, available), Variant, AddonGroup (min/max),
Addon, PriceList + PriceListEntry (areaId-specific price overrides).
People: User, Role, RolePermission, Device.
Stock: StockItem, StockMovement, Purchase + PurchaseLine, RecipeLine (see "Stock" below).

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
| 2 | table.status = reserved, or a booking holds it (P4-04: from `reservation.holdMin` before its time until `reservation.graceMin` after), and no open order | `RESERVED` |
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

## Stock (P2-10, migration 0005; decision in `adr/0003-stock-deducted-at-kot-fire.md`)
| Entity | Key fields | Notes |
| --- | --- | --- |
| StockItem | id, name, unit (kg/g/l/ml/pcs, fixed), onHandMilli, reorderLevelMilli, lastUnitCostPaise, active | Raw material; balance is a cache of the ledger |
| StockMovement | seq, id, stockItemId, deltaMilli, kind, refType (kot/purchase), refId, reason, unitCostPaise, businessDate, userId, commandId, at | Append-only ledger (triggers) |
| Purchase | id, supplierName, supplierGstin, invoiceNo, invoiceDate, note, totalPaise, status (posted/void), businessDate | Immutable; void reverses it |
| PurchaseLine | purchaseId, lineNo, stockItemId, qtyMilli, unitCostPaise, amountPaise | amount = qty × cost / 1000, half up |
| RecipeLine | ownerKind (item/variant/addon), ownerId, stockItemId, qtyMilli | Per one unit sold; a variant's recipe replaces its item's |

- Quantities are integer thousandths of the unit (1.5 kg = 1500); costs are integer paise per whole unit.
- Movement kinds: `opening`, `purchase`, `purchase_void`, `sale` (FireKOT), `wastage`, `count`, `adjust`.
- Invariant: `stock_item.on_hand_milli` = Σ `stock_movement.delta_milli` for that item (tested).
- Stock never blocks service: balances may go negative ("Count needed").
- Sold out (`menu_item.available = 0`) is separate from stock and set by people (`SetItemAvailability`).

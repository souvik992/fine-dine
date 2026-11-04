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
| OnlineOrder | hub order id, number ("W-1042"), state (contract OrderState), the hub's order as sent, localOrderId, billId, posTotal, prepMinutes, alert | P4-06 (`online_order`); the DinePOS order is type `online`, no table |
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
- `open → void` by **ReleaseTable**: the table is freed when the order has nothing to bill — no line still `fired`
  (cancel those first) and no bill row (a bill number was given: void that bill instead, numbers stay gap-free).
  Held lines are dropped with it; the audit row (`order.release`, optional reason) keeps them. Not for online orders.

## Derived table state (`deriveTableState`)
| Order of checks | Condition | State |
| --- | --- | --- |
| 1 | table.status = blocked | `BLOCKED` |
| 2 | table.status = reserved, or a booking holds it (P4-04: from `reservation.holdMin` before its time until `reservation.graceMin` after), and no open order | `RESERVED` |
| 3 | no open order | `FREE` |
| 4 | order has no fired KOT | `SEATED` |
| 5 | billPrintedAt set and not older than lastKotAt | `BILL_PRINTED` |
| 6 | the kitchen screens know all the food (no ticket at a station without a screen), none cooking, some ready | `FOOD_READY` |
| 7 | the same, none cooking or ready (all served) | `SERVED` ("Served · print bill") |
| 8 | otherwise | `KOT_RUNNING` |

Kitchen counts (6–7): the order's tickets with food still on it, at stations using a screen (marked for one, or with a
ticket bumped there in the last 7 business days), `apps/server/src/queries/kitchen-status.ts`. Without screens the
states are as before (KOT_RUNNING until the bill).

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
| RecipeLine | ownerKind (item/variant/addon), ownerId, stockItemId, qtyMilli | Per one unit sold; a variant's recipe replaces its item's. Bulk upload: `ImportRecipes` (CSV in `packages/shared/src/recipe-csv.ts`) |

- Quantities are integer thousandths of the unit (1.5 kg = 1500); costs are integer paise per whole unit.
- Movement kinds: `opening`, `purchase`, `purchase_void`, `sale` (FireKOT), `wastage`, `count`, `adjust`.
- Invariant: `stock_item.on_hand_milli` = Σ `stock_movement.delta_milli` for that item (tested).
- Stock never blocks service: balances may go negative ("Count needed").
- Sold out (`menu_item.available = 0`) is separate from stock and set by people (`SetItemAvailability`).

## Dish photos (migration 0014)
| Entity | Key fields | Notes |
| --- | --- | --- |
| MenuImage | name (`<sha256>.<webp/jpg/png>`), contentType, bytes, createdAt | Stored once by content, in the database (so backups carry it); at most 600 KB |
| MenuItemImage | itemId, imageName, setAt, setBy | One photo per dish; a photo no dish uses is removed |

- Photos are resized in the browser (at most 1024 px, WebP) before `SetItemImage`; the server only checks the bytes are
  a real JPG, PNG or WebP. `GET /v1/menu/images/<name>` serves them (cached for good: a name never changes content).
- `MenuItem.image` (menu snapshot) names the photo; the online connector uploads photos the hub lacks with each menu publish.

# 03 — Command API

All writes: `POST /v1/commands`. All reads: `GET /v1/...`. Base URL `http://<master>:7420`.

## Headers
| Header | Value |
| --- | --- |
| `Authorization` | `Device <deviceToken>` (P2-02; not needed from the master PC itself) |
| `X-User-Session` | session token from `POST /v1/sessions` (PIN login) |
| `X-Manager-Pin` | only when a command answered `PIN_REQUIRED` |

## Envelope
```json
{
  "commandId": "01JC9Z6K8Q4V7M2R0B3T5X1N9A",
  "type": "FireKOT",
  "orderId": "01JC9Y4D2...",
  "expectedVersion": 7,
  "payload": { "itemIds": ["01JC..."], "course": null },
  "createdAt": "2026-11-02T20:14:05+05:30"
}
```
- `commandId`: ULID made on the client; reused on retry.
- `orderId` + `expectedVersion`: required for commands on an existing order; omitted for `OpenTable`,
  `NewTakeaway`, menu/admin commands. Sending them to a command that does not take them is `VALIDATION`.
- Unknown envelope keys are rejected. `createdAt` must carry a UTC offset. Schema:
  `packages/shared/src/schemas/envelope.ts`.

## Success response
```json
{ "ok": true, "commandId": "...", "order": { "...snapshot..." }, "version": 8, "result": { } }
```

## Error response
```json
{ "ok": false, "error": { "code": "VERSION_CONFLICT", "message": "...", "details": { "currentVersion": 9 } }, "order": { } }
```

| Code | HTTP | When |
| --- | --- | --- |
| `VALIDATION` | 400 | zod failed |
| `UNAUTHENTICATED` | 401 | bad device token / session |
| `PIN_REQUIRED` | 401 | right needs manager PIN; resend with `X-Manager-Pin` |
| `FORBIDDEN` | 403 | user lacks right; `details.right` |
| `NOT_FOUND` | 404 | order/table/item missing |
| `VERSION_CONFLICT` | 409 | expectedVersion behind; current snapshot returned |
| `INVALID_STATE` | 422 | e.g. firing on a settled order, moving to an occupied table |
| `DAY_CLOSED` | 423 | business date closed |
| `LICENSE` | 402 | licence expired beyond grace / seat limit |
| `DUPLICATE` | 200 | replay of an already processed commandId; the original success body with `"duplicate": true` (the order snapshot is the one from the first run; refetch for current state). Replays work even after the day closed. Reusing a commandId for a different type/order/payload is `VALIDATION` |
| `INTERNAL` | 500 | unexpected server fault; message is generic, details only in the server log |

## Commands (v1)
| Type | Payload | Right | PIN | Effects | Leakage |
| --- | --- | --- | --- | --- | --- |
| `OpenTable` | tableId, covers, captainId? | order.create | | new order, table → SEATED | |
| `NewTakeaway` | customer? | order.create | | new takeaway order | |
| `AddItems` | items[{id, itemId, variantId?, qty, addons[], note?, course}] | order.edit | | items `held` | |
| `UpdateHeldItem` | orderItemId, qty?, note?, course?, addons? | order.edit | | | |
| `RemoveHeldItem` | orderItemId | order.edit | | | |
| `FireKOT` | itemIds[] \| course \| all:true | kot.fire | | KOT per station, print jobs | |
| `ModifyFiredItem` | orderItemId, newQty, reason | kot.modify | cfg | `modify` KOT | yes |
| `CancelFiredItem` | orderItemId, reason | kot.cancel | yes | `cancel` KOT | yes |
| `MoveTable` | toTableId | table.move | | order.tableId changes; `move_notice` KOT if any fired | if fired |
| `MergeTables` | sourceOrderId | table.merge | | source → merged, items re-parented | if fired |
| `TransferItems` | itemIds[], toOrderId | item.transfer | | items re-parented (KOT link kept) | yes |
| `SetCovers` / `AssignCaptain` | covers / captainId (null clears) | order.edit | | | |
| `RequestBill` | — | order.edit | | bill_request row, `bill.requested` on `floor` | |
| `SetCaptainSection` | userId, areaIds[], tableIds[] | staff.sections | | replaces the captain's section, `floor.changed` | |
| `PrintBill` | discount?{kind: pct\|amount, value, reason}, serviceCharge?{enabled, rateBp}, customer?{name, phone, gstin} | bill.print | if discount > role limit | bill row(s), billNo assigned, table → BILL_PRINTED | |
| `SplitBill` | mode: equal\|items\|proportion, parts | bill.split | | replaces unsettled bill rows | |
| `Settle` | billId, tenders[{mode, amountPaise, ref?}] | bill.settle | | payment rows; when all parts paid → settled, table FREE | |
| `VoidBill` | billId, reason | bill.void | yes | reversal, order → void | yes |
| `ReprintKOT` / `ReprintBill` | kotId / billId | reprint | cfg | print job with DUPLICATE | yes |
| `MarkKotReady` / `MarkKotServed` / `RecallKot` | kotId | kds.bump | | KOT timestamps only (no order version), `kot.status` | |
| `SetItemAvailability` | itemId, available | menu.stock | | menu.changed | |
| `OpenDrawer` | reason | drawer.open | cfg | ESC/POS drawer kick | yes |
| `PayIn` / `PayOut` | amountPaise, reason | cash.move | yes | cash register lines | |
| `DayEnd` | cashCountedPaise | dayend | yes | close business date, Z-report print | |

`cfg` = configurable per role in settings.

### Order command notes (P1-06; schemas in `packages/shared/src/schemas/commands/orders.ts`)
- `OpenTable` `{ tableId, covers, captainId?, orderId? }`: `orderId` is the client-made id for offline opens.
  Blocked or occupied table → `INVALID_STATE`. Result `{ orderId }` and the new snapshot at version 1.
- `AddItems` lines: `{ id, itemId, variantId?, qty, addons: [{ addonId, qty }], note?, course }`. Name
  ("Item (Variant)"), unit price (area price list first) and tax rate are snapshotted. An item with variants
  needs `variantId`; every linked addon group's min/max must hold (`VALIDATION`); unavailable item →
  `INVALID_STATE`. Addon qty is the addon's own count on the line.
- `UpdateHeldItem` / `RemoveHeldItem` work only on `held` items (`INVALID_STATE` once fired). Removing a held
  item deletes its row; the audit row keeps the full line.
- `FireKOT` takes exactly one of `{ itemIds }`, `{ course }`, `{ all: true }`. Result `{ kots: [{ id, kotNo,
  stationId, orderItemIds }] }`, KOTs ordered by station name.
- `AddItems`/`FireKOT` on a `billed` order return it to `open` and mark its printed bill `superseded`.
- Captains (P3-04): `OpenTable` without `captainId` takes the captain whose section lists the table, else the only
  captain whose section holds its area (none when two share it). `RequestBill` needs an `open` order with something
  sent to the kitchen (`INVALID_STATE` otherwise, "The bill is already printed." once billed); asking again moves the
  time on; `PrintBill` clears it. `SetCaptainSection` replaces the person's whole section (active staff, known areas
  and tables). The floor carries `captainName`, `sectionCaptainIds` and `billRequest { at, byName }`; the order
  snapshot carries `billRequest`. `GET /v1/captain-sections` → `{ sections[], people[] }` (people = active staff whose
  role has `order.create`).
- `SetCovers { covers: 1–99 }` (P3-02) only while the order is `open`: the printed bill shows the guests, so a
  `billed` order refuses with `INVALID_STATE`. Audited as `order.covers` with before/after; same covers is a no-op.

### Billing command notes (P1-10; schemas in `packages/shared/src/schemas/commands/billing.ts`)
- `PrintBill` discount `{ kind: pct|amount, value, reason }`: pct in basis points, amount in paise, reason
  required when value > 0. `serviceCharge.rateBp` defaults to setting `bill.serviceChargeBp`. Result
  `{ billId, billNo, revision, totalPaise, printerId, warning? }` (warning when no bill printer exists).
- `Settle` result `{ billId, paidPaise, changePaise }`. `DayEnd` result `{ closedDate, nextDate, zReport }`.
- `SetConfig` `{ values: { "<key>": value } }`, keys: `outlet.name`, `outlet.addressLines`, `outlet.gstin`,
  `outlet.fssai`, `outlet.phone`, `bill.prefix`, `bill.footerLines`, `bill.roundOffStep`, `bill.roundOffTie`,
  `bill.serviceChargeBp`, `bill.upiVpa`, `bill.upiPayeeName`, `bill.printerId`, `bill.display`, `bill.logo`,
  `kot.default_station_id`. Only changed keys are written and audited; result `{ changed }`; emits `config.changed`
  on `system`. `bill.display` and `bill.logo` are described in `packages/shared/src/bill-display.ts` (P2-12).

### SplitBill payloads
```json
{ "mode": "equal", "parts": 3 }
{ "mode": "items", "parts": [ { "items": [{ "orderItemId": "a", "qty": 2 }] }, { "items": [{ "orderItemId": "a", "qty": 1 }, { "orderItemId": "c", "qty": 1 }] } ] }
{ "mode": "proportion", "parts": [ { "weight": 2 }, { "weight": 1 }, { "weight": 1 } ] }
```
Rules in `docs/08-billing-gst.md`. 2 to 20 parts; by item, every billed line's whole quantity must be assigned
(`VALIDATION`). Only on a printed bill with nothing paid (`INVALID_STATE`). Result `{ bills: [{ billId, billNo,
totalPaise }] }`; each part is printed ("Part 2 of 3"). `Settle` on a part settles that bill; the order and the
table close with the last part (result `unpaidParts`).

## Queries
| GET | Returns |
| --- | --- |
| `/v1/health` | ok, version, schemaVersion, businessDate, timeZone, serverTime, uptimeSec (licence status: P2-09). `ok` is false while no business date is open |
| `/v1/floor` | `FloorSnapshot`: serverTime, areas[], tables[] (state via `deriveTableState`, orderId, orderVersion, covers, captainId, since, elapsedMin, amountPaise) |
| `/v1/orders/:id` | `OrderSnapshot` (items with addons, KOTs, bills with paid amount, version, running totals); 404 unknown, 400 not a ULID |
| `/v1/orders?state=open` | open orders |
| `/v1/menu?areaId=&since=<version>` | `MenuSnapshot` (active items; the area's price list overrides base/variant prices; with `areaId` also the area's tax `pricingMode`, P3-03) or `{ menuVersion, unchanged: true }` when `since` is current |
| `/v1/kds/tickets?stationId=` | P4-02: `KdsBoard` — station, `amberMin`/`redMin`, today's unserved tickets of the station as printed (docs/06 KDS) |
| `/v1/network` | P4-02: `{ urls }` — `http://<lan-ip>:<port>` addresses phones and kitchen screens can open |
| `/v1/reports/:name?from=&to=` | P4-03 (`apps/server/src/reports/catalog.ts`, right `reports.view`): a `ReportTable` (columns, rows, totals, summary; money in paise) over business dates, default today, at most a year. `GET /v1/reports` lists them: daily, items, categories, areas, tables, gst, payments, cash, discounts, voids, kot-changes, kitchen (P4-02: kitchen speed per station), captains (P3-05: per captain of the order — tables served, guests, net sales, per cover, average bill, dishes sent, average stay, changes after the KOT; settled orders only, orders without a captain last) |
| `/v1/audit?from=&to=&leakage=1&card=&before=&limit=` | P4-01 (`reports.view`): `{ entries: [{ seq, at, label, ref, amountPaise, reason, leakage, by, approvedBy, device }], next }`, newest first; `card` narrows to one leakage card; dates are the outlet's calendar days |
| `/v1/leakage?from=&to=` | P4-01 (`reports.view`): `{ cards: [{ key, label, hint, count, amountPaise, actions }], unbilled: { orders, items, amountPaise } }` |
| `/v1/config` | outlet and billing settings with defaults applied (nothing secret) |
| `/v1/printers` | `{ printers: [{ id, name, transport, role, widthMm, backupPrinterId?, status, queued, failedToday, lastError? }] }` |

## Staff commands (P2-01; schemas in `packages/shared/src/schemas/commands/users.ts`)
| Type | Payload | Right |
| --- | --- | --- |
| `SetupOutlet` | outletName, ownerId, ownerName, pin | none: only while no staff exist |
| `UpsertUser` | id, name, roleId, pin? (required when new), active | users.manage |
| `UpsertRole` | id, name, discountLimitBp, rights[{right, needsPin}] | users.manage |

Sessions: `POST /v1/sessions`, `GET /v1/session`, `DELETE /v1/session`, `GET /v1/setup-state` (public),
`GET /v1/staff`, `GET /v1/roles` (users.manage). Commands without a valid `X-User-Session` answer `UNAUTHENTICATED`.

`GET /v1/admin/catalog` (admin) returns everything the settings screens edit, inactive records included:
`{ areas, tables (with occupied), printers (all fields), stations (with printerIds), categories, addonGroups, items }`.

`PrintTestPage` { printerId } (right admin): queues a short test page (outlet name, printer name, width, time)
on that printer through the normal print queue; result `{ printerId }`.

`PrintSampleBill` { printerId } (right admin, P2-12): prints a made-up dine-in bill with the saved bill design,
marked `*** SAMPLE - NOT A BILL ***` at the top and bottom; it takes no bill number and stores no bill.
`POST /v1/bill-preview` { widthMm: 58|80, config?: partial config } (admin; a read, nothing is stored) returns
`{ preview }`: the same sample rendered with the saved settings overlaid by the unsaved ones (the live preview).

### After the KOT (P2-04; schemas in `packages/shared/src/schemas/commands/orders.ts`)
- `ModifyFiredItem` `{ orderItemId, newQty, reason, returnToStock? }`: only reduces (`newQty` below the current
  qty, else `INVALID_STATE`: add the item again to add more). The line keeps `newQty`; the removed part becomes a
  new `cancelled` line on the same KOT. Add-ons are charged per line and stay with the remaining part. Result
  `{ orderItemId, qty, kotId, kotNo }` (the slip).
- `CancelFiredItem` `{ orderItemId, reason, returnToStock? }`: the line becomes `cancelled` (kept, off the bill).
- Both send a change slip (`modify` / `cancel` KOT: `-qty name`, `now n`, "Changes KOT 0042", the reason) to the
  line's station, supersede a printed bill (like adding items), audit with the reason and set the leakage flag.
  `returnToStock: true` ("not prepared") posts `adjust` movements for the removed portions' recipe (ADR-0003).
  A held line → `INVALID_STATE` (change it in the cart); a cancelled line → `INVALID_STATE`.
- `ReprintKOT` `{ kotId }`: the stored ticket (`kot_document`, migration 0006) marked DUPLICATE on the station's
  printers; `kot.reprint_count` + 1. `ReprintBill` `{ billId }`: the latest `bill_document` revision marked DUPLICATE,
  same number; `INVALID_STATE` when superseded (print again with PrintBill) or void; works on settled bills; the
  count comes from the audit log (settled bill rows are frozen). Both: leakage flag, no order version change.
- PIN rules come from the role (`kot.modify`, `kot.cancel`, `reprint` with needs-PIN): by default Cashier needs a
  manager PIN for all three, Captain for modify and cancel; the approver is recorded on the audit rows.

### Tables (P2-03)
- `MoveTable` `{ toTableId }` (on the order being moved): the table must be free (not blocked; occupied →
  `INVALID_STATE`, use Merge). Prices and KOTs are unchanged (snapshots). Stations with sent items get a
  `move_notice` slip "MOVED T4 -> T9". Leakage flag once a KOT exists.
- `MergeTables` `{ sourceOrderId }` (on the order that stays): the source's lines move here
  (`original_order_id` = source; `kot_id` unchanged; the KOT rows stay with the source order), covers add up, the
  source becomes `merged` (`merged_into`, version + 1) and its table is freed; printed bills of both are superseded.
  Notice "MERGED T4 -> T9"; leakage flag if sent items moved.
- `TransferItems` `{ itemIds, toOrderId }` (on the order the lines leave): whole held or sent lines (cancelled →
  `INVALID_STATE`) go to another open order (version + 1, printed bill superseded). Sent lines keep their KOT link;
  their stations get "ITEMS T4 -> T9" listing them. Leakage flag when sent lines moved (held lines are not flagged,
  as docs/02 lists "transfer after a KOT exists").
- A superseded bill clears the order's `bill_printed_at` (the table no longer shows "bill printed"); table state
  counts sent items even when their KOT belongs to a merged order.

### Void and cash (P2-06; schemas in `packages/shared/src/schemas/commands/billing.ts`)
- `VoidBill` `{ billId, reason }` (on the bill's order; right `bill.void`, PIN per role): a `printed` or `settled` bill
  of the **current business date** (a closed day → `INVALID_STATE`). The bill keeps its number and becomes `void`;
  its payments are reversed with negative payment rows (append-only); a VOID copy prints with the reason. The order
  becomes `void` when none of its bills is live (a voided part of a split leaves the others payable) and its table
  is freed. Stock is not returned. Leakage flag. Result `{ billId, billNo, refundPaise, orderState }`.
- `PayIn` / `PayOut` `{ amountPaise, reason }` (right `cash.move`): a `cash_movement` row of the business date
  (counted in the day-end cash expected); a slip prints on the bill printer and the drawer opens. Pay-out is a
  leakage flag.
- `OpenDrawer` `{ reason }` (right `drawer.open`): drawer kick + slip on the bill printer (none → `INVALID_STATE`);
  leakage flag.
- Reads (session with `bill.settle`): `GET /v1/bills?date=` → `{ date, bills: DayBill[] }` (numbered bills of the
  business date, VOID included, net payments per mode); `GET /v1/cash?date=` → `{ date, movements }`.
- The Z-report lists VOID bills by number with their amount and reason (not in sales), and pay-ins / pay-outs.

### Backups (P2-08; routes, not commands: backups are files and a restore replaces the database)
`GET /v1/admin/backups` (admin) → `{ status, backups: [{ file, kind, at, bytes }] }`; `POST /v1/admin/backups` (admin)
→ `{ backup }` (made and checked); `POST /v1/admin/restore` `{ file }` (users.manage + Owner PIN) → `{ restoring,
safetyBackup, restarting: true }`, then the server restarts on the backup. Rules in `docs/07` "Backups".

## Stock commands (P2-10/P2-11; schemas in `packages/shared/src/schemas/commands/stock.ts` and `menu-csv.ts`)
Quantities are integer thousandths of the material's unit (`qtyMilli`), costs integer paise per whole unit.
| Type | Payload | Right | Effect |
| --- | --- | --- | --- |
| `UpsertStockItem` | id, name, unit (kg/g/l/ml/pcs), reorderLevelMilli, active, opening?{qtyMilli, unitCostPaise} | stock.manage | Opening only on create; unit fixed (`INVALID_STATE`); name unique among active; cannot switch off while in a recipe |
| `AdjustStock` | kind: wastage{qtyMilli, reason} \| count{qtyMilli, reason?} \| adjust{qtyMilli ±, reason} | stock.manage | One movement (none when a count matches); audited `stock.<kind>` |
| `RecordPurchase` | id, supplierName, supplierGstin?, invoiceNo?, invoiceDate?, note?, lines[{stockItemId, qtyMilli, unitCostPaise}] | stock.manage | Adds stock, sets last cost; result `{ purchaseId, totalPaise }`; same id twice → `INVALID_STATE` |
| `VoidPurchase` | purchaseId, reason | stock.manage | Reverses every line; last cost falls back to the latest posted purchase, else the opening cost |
| `SetRecipe` | ownerKind (item/variant/addon), ownerId, lines[{stockItemId, qtyMilli}] | stock.manage | Replaces the recipe; `[]` removes it |
| `SetItemAvailability` | itemId, available | menu.stock | Sold out / back on; `menu.changed`; no-op when unchanged |
| `ImportMenu` | importId, items[{name, category, pricePaise, taxRateBp, shortCode, veg, hsnSac}] (≤ 1000) | admin | All or nothing: name or code already on the menu / repeated → `VALIDATION` with `details.problems[{item, message}]`; categories matched ignoring case and spaces, missing ones created |

`FireKOT` also posts `sale` movements for the fired lines' recipes (ADR-0003) and emits `stock.changed`.

Stock queries (need a session with `stock.manage`): `GET /v1/stock` → `{ items: StockItemView[] }`;
`GET /v1/stock/:id/movements?limit` → `{ movements }` (newest first, with KOT or supplier text);
`GET /v1/stock/usage?from&to` (business dates) → `{ rows: StockUsageRow[] }`;
`GET /v1/purchases?limit&offset` → `{ purchases, suppliers }`; `GET /v1/purchases/:id`; `GET /v1/recipes` → `{ lines }`.

## Admin endpoints (also commands, admin right)
`UpsertArea`, `UpsertTable`, `UpsertCategory`, `UpsertMenuItem`, `UpsertAddonGroup`, `UpsertStation`,
`UpsertPrinter`, `UpsertUser`, `UpsertRole`, `PairDevice`, `RevokeDevice`, `SetConfig`.

Built in P1-05 (payload schemas in `packages/shared/src/schemas/commands/admin.ts`): every `Upsert*` takes the
record `id` (ULID) and inserts or updates it; result `{ id, created }`. Right `admin`; allowed while the day is
closed; audited as `<entity>.create|update` with before/after. Rules:
- References must exist (`NOT_FOUND` with `details.field`). Table labels are unique per area and short codes
  unique per outlet (case-insensitive) → `INVALID_STATE`. A table with an open order cannot be blocked/reserved.
- Nothing is deleted: variants and addons left out of a payload are kept; deactivate an item with `active: false`.
  Link sets (`UpsertStation.printerIds`, `UpsertMenuItem.addonGroupIds`) are replaced as a whole.
- Menu changes bump the `counter` row `menu_version` and emit `menu.changed`; area/table changes emit
  `floor.changed`; printer changes emit `printer.changed`. (Known gap: an unchanged upsert still bumps the
  version and writes an audit row.)
- `UpsertAddonGroup` (not in the original list) is needed because addon groups are shared across items.

## Order snapshot shape (abridged)
```ts
type OrderSnapshot = {
  id: string; version: number; state: 'open'|'billed'|'settled'|'void'|'merged';
  type: 'dine_in'|'takeaway'|'delivery'|'online';
  table?: { id: string; label: string; areaId: string };
  covers: number; captainId?: string; openedAt: string;
  items: Array<{ id: string; name: string; qty: number; unitPricePaise: number; addons: {...}[];
                 note?: string; course: number; status: 'held'|'fired'|'cancelled'; kotNo?: number }>;
  kots: Array<{ id: string; kotNo: number; stationId: string; kind: string; firedAt: string; readyAt?: string }>;
  bills: Array<{ id: string; billNo?: number; splitNo: number; totalPaise: number; state: string; paidPaise: number }>;
  totals: { subtotalPaise: number; taxPaise: number; totalPaise: number };
};
```

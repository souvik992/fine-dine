# 03 — Command API

All writes: `POST /v1/commands`. All reads: `GET /v1/...`. Base URL `http://<master>:7420`.

## Headers
| Header | Value |
| --- | --- |
| `Authorization` | `Device <deviceToken>` |
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
| `SetCovers` / `AssignCaptain` | covers / captainId | order.edit | | | |
| `PrintBill` | discount?{kind: pct\|amount, value, reason}, serviceCharge?{enabled, rateBp}, customer?{name, phone, gstin} | bill.print | if discount > role limit | bill row(s), billNo assigned, table → BILL_PRINTED | |
| `SplitBill` | mode: equal\|items\|proportion, parts | bill.split | | replaces unsettled bill rows | |
| `Settle` | billId, tenders[{mode, amountPaise, ref?}] | bill.settle | | payment rows; when all parts paid → settled, table FREE | |
| `VoidBill` | billId, reason | bill.void | yes | reversal, order → void | yes |
| `ReprintKOT` / `ReprintBill` | kotId / billId | reprint | cfg | print job with DUPLICATE | yes |
| `MarkKotReady` / `MarkKotServed` | kotId | kds.bump | | timestamps | |
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

### Billing command notes (P1-10; schemas in `packages/shared/src/schemas/commands/billing.ts`)
- `PrintBill` discount `{ kind: pct|amount, value, reason }`: pct in basis points, amount in paise, reason
  required when value > 0. `serviceCharge.rateBp` defaults to setting `bill.serviceChargeBp`. Result
  `{ billId, billNo, revision, totalPaise, printerId, warning? }` (warning when no bill printer exists).
- `Settle` result `{ billId, paidPaise, changePaise }`. `DayEnd` result `{ closedDate, nextDate, zReport }`.
- `SetConfig` `{ values: { "<key>": value } }`, keys: `outlet.name`, `outlet.addressLines`, `outlet.gstin`,
  `outlet.fssai`, `outlet.phone`, `bill.prefix`, `bill.footerLines`, `bill.roundOffStep`, `bill.roundOffTie`,
  `bill.serviceChargeBp`, `bill.upiVpa`, `bill.upiPayeeName`, `bill.printerId`, `kot.default_station_id`. Only
  changed keys are written and audited; result `{ changed }`; emits `config.changed` on `system`.

### SplitBill payloads
```json
{ "mode": "equal", "parts": 3 }
{ "mode": "items", "parts": [ { "itemIds": ["a","b"] }, { "itemIds": ["c"] } ] }
{ "mode": "proportion", "parts": [ { "weight": 2 }, { "weight": 1 }, { "weight": 1 } ] }
```
Rules in `docs/08-billing-gst.md`.

## Queries
| GET | Returns |
| --- | --- |
| `/v1/health` | ok, version, schemaVersion, businessDate, timeZone, serverTime, uptimeSec (licence status: P2-09). `ok` is false while no business date is open |
| `/v1/floor` | `FloorSnapshot`: serverTime, areas[], tables[] (state via `deriveTableState`, orderId, orderVersion, covers, captainId, since, elapsedMin, amountPaise) |
| `/v1/orders/:id` | `OrderSnapshot` (items with addons, KOTs, bills with paid amount, version, running totals); 404 unknown, 400 not a ULID |
| `/v1/orders?state=open` | open orders |
| `/v1/menu?areaId=&since=<version>` | `MenuSnapshot` (active items; the area's price list overrides base/variant prices) or `{ menuVersion, unchanged: true }` when `since` is current |
| `/v1/reports/:name?from=&to=` | report rows (see `docs/10-roadmap.md` P4 list) |
| `/v1/audit?from=&to=&leakage=1` | audit events |
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

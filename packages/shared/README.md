# @dinepos/shared

Code used by the server **and** every client. No Node-only or DOM-only APIs here (must run in Electron
renderer, PWA and Node).

## Contents (to build)
| File | What |
| --- | --- |
| `src/money.ts` | paise arithmetic, `roundHalfUp`, `mulDivRound`, `applyRate`, `allocateLargestRemainder(total, weights)`, `roundOff(amount, step, tie)`, `formatINR`, `parseRupees` |
| `src/tax.ts` | `lineTax(amount, rateBp, mode)`, `splitCgstSgst(tax)` |
| `src/bill-calc.ts` | `calculateBill(lines, { pricingMode, interState, discount, serviceChargeBp, roundOffStep, roundOffTie })` → full breakup; `checkBillInvariants` |
| `src/split.ts` | `splitEqual`, `splitByItems`, `splitByProportion` (Σ parts = total) |
| `src/table-state.ts` | `deriveTableState(table, order)` per `docs/02-domain-model.md` (built in P1-05 for `/v1/floor`) |
| `src/ids.ts` | `newId()` (ULID), `isUlid`, `ULID_RE` |
| `src/time.ts` | `localDate`, `isoInZone`, `addDays`, `isIsoDate`, `isValidTimeZone` (Intl only) |
| `src/schemas/envelope.ts` | command envelope zod schema |
| `src/schemas/commands/*.ts` | one zod schema per command payload (`admin.ts` holds the Upsert* group) |
| `src/schemas/events.ts` | WS message + event payload schemas |
| `src/types.ts` | `OrderSnapshot`, `CommandResponse`, `ERROR_CODES` (`FloorTable`, `MenuSnapshot` in P1-05) |
| `src/rights.ts` | the list of permission strings |

## Rules
- Pure functions, fully unit-tested, no I/O.
- Money in, money out: integers only. Add a test that fails if any helper returns a non-integer.

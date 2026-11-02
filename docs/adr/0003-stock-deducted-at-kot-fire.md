# ADR-0003: Recipe stock is used when the KOT is fired

- Status: accepted
- Date: 2026-11-02

## Context
TiffinPOS (QSR) takes recipe ingredients out of stock when the bill is finalised: in a QSR the bill and the
cooking happen at the same moment. In a dine-in restaurant they are far apart. Food is cooked when the KOT reaches
the kitchen; the bill may be printed an hour later, split, re-issued or (after P2-06) voided. Items cancelled after
firing (P2-04) were usually already cooked.

## Decision
- `FireKOT` posts one `sale` movement per material per KOT (`ref_type = 'kot'`), in the same transaction.
- Quantity = the variant's recipe if it has one, else the item's, × line qty; plus each add-on's recipe × the
  add-on's qty on the line. Lines without a recipe use nothing.
- Stock never blocks a KOT. Balances may go negative; the Stock screen shows "Count needed".
- Bills, re-issues, splits and voids do not touch stock. A cancelled fired item is not given back automatically:
  if it was not cooked, the manager records a correction (`AdjustStock`), which is audited.
- The ledger (`stock_movement`) is append-only (triggers); `stock_item.on_hand_milli` is a cache of its sum.

## Consequences
- Consumption reports match what the kitchen actually made, including cancelled-after-fire food (a leakage signal).
- Items that were never cooked: since P2-04, Modify/CancelFiredItem take `returnToStock` ("Not prepared yet" in the
  dialog), which posts `adjust` movements for the removed portions' recipe, referenced to the change slip.
- No change to billing, bill numbering or printed bills.

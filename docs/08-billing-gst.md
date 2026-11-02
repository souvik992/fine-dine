# 08 — Billing and GST rules

> Confirm tax treatment with the outlet's CA. These are the defaults the software must support; every rate
> is configurable.

## Units
- Money: integer paise. Rates: basis points (5% = 500). Never floats.
- Rounding helper: `roundHalfUp(numerator, denominator)` on integers; halves round up (away from zero for
  negatives, so a refund mirrors its sale). Products use a BigInt intermediate (`mulDivRound`).

## Tax profile
| Setting | Default | Notes |
| --- | --- | --- |
| Pricing mode | exclusive | menu price excludes GST; `inclusive` also supported |
| Restaurant GST | 5% (CGST 2.5 + SGST 2.5), no ITC | standalone restaurants |
| Hotel restaurant | 18% with ITC | restaurants in hotels with room tariff above ₹7,500/night |
| Alcohol | outside GST (state VAT) | separate tax profile per item category |
| Inter-state | IGST | rare for dine-in; supported in tax profile |

## Bill calculation (exclusive pricing)
1. Line amount = unit price × qty + Σ(addon price × addon qty).
2. Subtotal = Σ line amounts (cancelled items excluded).
3. Discount: percent or amount, applied before tax, allocated across lines pro rata by line amount
   (largest-remainder method so the allocation sums exactly).
4. Service charge (optional, off by default): rate on discounted subtotal; taxed at the same GST rate as food.
   Guest must be able to decline — the toggle is per bill, never forced (CCPA guidance, July 2022).
   - Mixed rates (decided 2026-11-02, industry practice; **CA to confirm**): the service charge is allocated
     to lines pro rata by their pre-GST value after discount (largest remainder) and each share is taxed at
     that line's own rate, so the share on a 0% / non-GST line (e.g. alcohol) carries no GST.
   - Base is always the pre-GST value: in inclusive mode it is the taxable value, not the menu price.
     Service charge is never in the menu price, so its GST is added on top in both modes.
5. Tax per line = round(discounted line × rateBp / 10000); service charge share tax likewise. Group by rate
   for printing; split each rate group's tax CGST/SGST equally (odd paisa goes to CGST). Inter-state: IGST.
6. Round-off to nearest rupee (configurable: none / 0.50 / 1.00). Round-off printed as its own line.
   An exact half follows the `roundOffTie` setting: `up` (default, ₹101.50 → ₹102) or `down` (→ ₹101).
7. Total = discounted subtotal + service charge + taxes + round-off (= Σ taxable + Σ tax + round-off).

Implemented by `calculateBill` in `packages/shared/src/bill-calc.ts`; `checkBillInvariants` verifies a
breakup adds up. Addon qty in step 1 is the addon's own quantity on the line (not multiplied by item qty).

Inclusive pricing: tax = round(line × rate / (10000 + rate)); taxable = line − tax.

## Split bills
- `equal`: n parts; each part gets every line at qty/n using proportional amounts; remainders to the last part.
- `items`: each item (or item quantity) assigned to exactly one part; unassigned items are an error.
- `proportion`: weights; amounts allocated by largest remainder.
- Each part is a full bill row with its own bill number, tax breakup and tenders.
- Σ parts = unsplit total exactly (test this with random orders: property test).

## Numbering
- Bill numbers: per financial year (1 Apr–31 Mar), gap-free, prefix configurable (`T1/26-27/000123`).
- Assigned at first `PrintBill`; reprints keep the number; adding items after print supersedes the
  unpaid bill (same number reused for the new print; superseded version kept in audit).
- Voided bills keep their number and print as VOID in reports.

## E-invoicing
- Applies only to B2B invoices of businesses whose turnover crossed ₹5 crore in any FY since 2017-18; B2C
  restaurant bills are out of scope.
- v1: capture customer GSTIN on the bill. Phase 4+: optional IRP connector to fetch IRN + QR.

## Day-end
- On start the server opens a business date if none is open: today in the outlet time zone, or the day
  after the last closed date if that is later (DayEnd run early must not reopen the same date). Audited as
  `business_day/day.open`. A running day never changes at midnight.
- Business date closes only via `DayEnd`. Open orders block day-end unless moved to next day (manager).
- Z-report printed and stored; counters for KOT no. reset next date.

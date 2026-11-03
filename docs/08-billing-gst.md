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

Decided 2026-11-02 (**CA to confirm**): dine-in is always CGST + SGST, because the place of supply is the
restaurant. A guest GSTIN (checksum-validated) is stored and printed but never switches a bill to IGST.

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

Built in P2-05 (`packages/shared/src/split-bill.ts`, `SplitBill`): the whole bill is calculated once with the
discount and service charge it was printed with; each line's net, discount, tax, service charge and its tax are
shared out to the parts by weights (largest remainder, ties to the later part), so nothing is taxed twice and every
part is a valid bill (`checkBillInvariants`). A line can be shared by quantity ("2/3 of 640.00" on the part).
Decided 2026-11-02 with the product owner:
- **Rounding:** every part is rounded to the round-off step; the round-off is spread in whole steps so the parts
  still add up to the unsplit total (₹1,213 in 3 → 404 + 404 + 405).
- **Numbers:** split after printing. The printed bill keeps its number as Part 1; Parts 2..n take the next numbers.
  A re-split reuses the numbers in order; a part no longer needed is voided (keeps its number, VOID in reports).
  Printing the bill again after items were added reuses Part 1's number and voids the other parts.
- Paying a part leaves the table occupied until the last part is paid. Once a part is paid the order cannot change
  (adding, cancelling, moving items or re-splitting is refused): changes go on a new order.

## Numbering
- Bill numbers: per financial year (1 Apr–31 Mar), gap-free, prefix configurable (`T1/26-27/000123`).
  Decided 2026-11-02: prefix setting `bill.prefix`, 1–3 capital letters/digits, default `B` (`B/26-27/000001`,
  ≤ 16 characters). The **invoice date and FY are the calendar date of printing** in the outlet time zone (a bill
  printed at 00:30 on 1 April is in the new FY even if the business date is still 31 March); reports and the
  Z-report use the business date. The number comes from `counter` row `bill_no:<fy>` inside the PrintBill
  transaction, so a refused or rolled-back PrintBill never uses one up.
- PrintBill is refused while items are held (not yet sent to the kitchen) or nothing is fired, and on an order
  that is already billed (reprint: P2-04). Each print stores the exact document in `bill_document` (append-only,
  one revision per print) so reprints match. A re-issue after a supersede keeps the bill row, number and printed
  number text, and adds revision 2, 3 …
- Settle: tenders must cover the total exactly; only cash may exceed it (the excess is change, and the cash
  payment row records what was kept). `due` needs a guest name or phone on the bill; `complimentary` needs a
  reason (in `ref`) and is a leakage flag. Settled bills and all payment rows are immutable (triggers, 0003).
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
- Built in P1-10: DayEnd lists the open tables when refused. The Z-report covers bills, covers, KOTs, gross,
  discounts, service charge, CGST/SGST/IGST, round-off, net; payments by mode; sales by area; sales by category
  (before discount); items cancelled after a KOT; cash expected (cash payments + opening/pay-ins − pay-outs) vs
  counted (a difference is a leakage flag). Stored in `business_day.z_report_json`, printed on the bill printer.
  The next business date opens in the same transaction; `processed_command` older than 7 days and all but the
  last 10,000 `event_log` rows are pruned.

## Online orders (P4-06; product owner 2026-11-03)
- The bill is DinePOS's own, at its menu prices (exclusive of GST, as orders without a table are), with no service
  charge and no discount; the hub's total is what the customer was shown. A difference is flagged and staff decide;
  automatic accepting never bills a different total.
- Delivery and packaging charges are bill lines taxed at the outlet's setting (Settings › Online orders › GST on
  charges); with no rate set, no charges can be added (the hub then refuses them too). Delivery charge by distance band
  (free above the band's amount), from the outlet's own settings.
- Paid online: settled at once as payment mode `online` (reference = the hub's order number). Cash at pickup / on
  delivery: settled in cash when marked collected / delivered. Cancelling after acceptance voids the bill (keeps its
  number; payments reversed), with the bill.void right and its PIN rule.

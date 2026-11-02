// Full bill breakup (docs/08-billing-gst.md). The server is the only caller that prints amounts;
// clients may call it for previews but always show the server's figures on a printed bill.
import {
  allocateLargestRemainder,
  applyRate,
  assertInt,
  assertNonNegative,
  BP_DENOMINATOR,
  multiplyPaise,
  roundOff,
  sumPaise,
  type RoundOffStep,
  type RoundOffTie,
} from './money.js';
import { lineTax, splitCgstSgst, type PricingMode } from './tax.js';

export interface BillAddonInput {
  qty: number;
  pricePaise: number;
}

export interface BillLineInput {
  id: string;
  qty: number;
  unitPricePaise: number;
  taxRateBp: number;
  addons?: readonly BillAddonInput[];
}

export type BillDiscount = { kind: 'pct'; valueBp: number } | { kind: 'amount'; valuePaise: number };

export interface BillOptions {
  pricingMode?: PricingMode;
  interState?: boolean;
  discount?: BillDiscount | null;
  /** Off unless set; the guest may decline it, so it is chosen per bill. */
  serviceChargeBp?: number | null;
  roundOffStep?: RoundOffStep;
  roundOffTie?: RoundOffTie;
}

export interface BillLine {
  id: string;
  taxRateBp: number;
  /** unit price × qty + Σ addon price × addon qty (tax-inclusive in inclusive mode). */
  amount: number;
  discount: number;
  /** amount − discount. */
  net: number;
  taxable: number;
  tax: number;
  serviceCharge: number;
  serviceChargeTax: number;
}

export interface TaxGroup {
  rateBp: number;
  /** Food + service charge value taxed at this rate. */
  taxable: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface BillBreakup {
  pricingMode: PricingMode;
  lines: BillLine[];
  subtotal: number;
  discount: number;
  serviceCharge: number;
  taxable: number;
  taxGroups: TaxGroup[];
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  roundOff: number;
  total: number;
}

export function lineAmount(line: BillLineInput): number {
  assertNonNegative(line.unitPricePaise, 'unitPricePaise');
  if (!Number.isSafeInteger(line.qty) || line.qty <= 0) throw new RangeError(`line ${line.id}: qty must be a positive integer`);
  const addons = (line.addons ?? []).map((a) => {
    assertNonNegative(a.pricePaise, 'addon pricePaise');
    assertNonNegative(a.qty, 'addon qty');
    return multiplyPaise(a.pricePaise, a.qty);
  });
  return sumPaise([multiplyPaise(line.unitPricePaise, line.qty), ...addons]);
}

function resolveDiscount(discount: BillDiscount | null | undefined, base: number): number {
  if (!discount) return 0;
  if (discount.kind === 'pct') {
    assertNonNegative(discount.valueBp, 'discount valueBp');
    if (discount.valueBp > BP_DENOMINATOR) throw new RangeError('percent discount cannot exceed 100%');
    return applyRate(base, discount.valueBp);
  }
  assertNonNegative(discount.valuePaise, 'discount valuePaise');
  if (discount.valuePaise > base) throw new RangeError('discount exceeds the bill subtotal');
  return discount.valuePaise;
}

/**
 * 1. line amount → 2. subtotal → 3. discount, pro rata by line amount (largest remainder)
 * → 4. GST per line → 5. service charge on the pre-GST value after discount, spread over lines the same
 * way, each share taxed at its line's rate → 6. group by rate, CGST/SGST per group (odd paisa to CGST)
 * → 7. round-off → total = taxable + tax + round-off.
 */
export function calculateBill(lines: readonly BillLineInput[], opts: BillOptions = {}): BillBreakup {
  const mode = opts.pricingMode ?? 'exclusive';
  const interState = opts.interState ?? false;
  const seen = new Set<string>();
  for (const l of lines) {
    assertNonNegative(l.taxRateBp, `line ${l.id}: taxRateBp`);
    if (seen.has(l.id)) throw new RangeError(`duplicate line id ${l.id}`);
    seen.add(l.id);
  }

  const amounts = lines.map(lineAmount);
  const subtotal = sumPaise(amounts);
  const discount = resolveDiscount(opts.discount, subtotal);
  const lineDiscounts = discount === 0 ? amounts.map(() => 0) : allocateLargestRemainder(discount, amounts);
  const nets = amounts.map((a, i) => a - lineDiscounts[i]!);
  const foodTax = nets.map((net, i) => lineTax(net, lines[i]!.taxRateBp, mode));

  const scRate = opts.serviceChargeBp ?? 0;
  assertNonNegative(scRate, 'serviceChargeBp');
  const scBase = foodTax.map((t) => t.taxable);
  const scBaseTotal = sumPaise(scBase);
  const serviceCharge = applyRate(scBaseTotal, scRate);
  const scShares = serviceCharge === 0 ? scBase.map(() => 0) : allocateLargestRemainder(serviceCharge, scBase);

  const billLines: BillLine[] = lines.map((l, i) => {
    const sc = scShares[i]!;
    return {
      id: l.id,
      taxRateBp: l.taxRateBp,
      amount: amounts[i]!,
      discount: lineDiscounts[i]!,
      net: nets[i]!,
      taxable: foodTax[i]!.taxable,
      tax: foodTax[i]!.tax,
      serviceCharge: sc,
      // Service charge is never in the menu price, so it is taxed on top in both modes.
      serviceChargeTax: applyRate(sc, l.taxRateBp),
    };
  });

  const groups = new Map<number, { taxable: number; tax: number }>();
  for (const l of billLines) {
    const g = groups.get(l.taxRateBp) ?? { taxable: 0, tax: 0 };
    g.taxable = sumPaise([g.taxable, l.taxable, l.serviceCharge]);
    g.tax = sumPaise([g.tax, l.tax, l.serviceChargeTax]);
    groups.set(l.taxRateBp, g);
  }
  const taxGroups: TaxGroup[] = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateBp, g]) => ({ rateBp, ...g, ...splitCgstSgst(g.tax, interState) }));

  const taxable = sumPaise(taxGroups.map((g) => g.taxable));
  const totalTax = sumPaise(taxGroups.map((g) => g.tax));
  const preRound = taxable + totalTax;
  const adjust = roundOff(preRound, opts.roundOffStep ?? 100, opts.roundOffTie ?? 'up');

  return {
    pricingMode: mode,
    lines: billLines,
    subtotal,
    discount,
    serviceCharge,
    taxable,
    taxGroups,
    cgst: sumPaise(taxGroups.map((g) => g.cgst)),
    sgst: sumPaise(taxGroups.map((g) => g.sgst)),
    igst: sumPaise(taxGroups.map((g) => g.igst)),
    totalTax,
    roundOff: adjust,
    total: preRound + adjust,
  };
}

/** Internal consistency checks; an empty list means the breakup adds up. Used by tests and the server. */
export function checkBillInvariants(b: BillBreakup): string[] {
  const errs: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number') {
      try {
        assertInt(v, path);
      } catch {
        errs.push(`${path} is not a safe integer`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(b, 'bill');
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  if (sum(b.lines.map((l) => l.amount)) !== b.subtotal) errs.push('Σ line amounts ≠ subtotal');
  if (sum(b.lines.map((l) => l.discount)) !== b.discount) errs.push('Σ line discounts ≠ discount');
  if (sum(b.lines.map((l) => l.serviceCharge)) !== b.serviceCharge) errs.push('Σ line service charge ≠ service charge');
  for (const l of b.lines) {
    if (l.net !== l.amount - l.discount) errs.push(`line ${l.id}: net ≠ amount − discount`);
    if (b.pricingMode === 'exclusive' ? l.taxable !== l.net : l.taxable + l.tax !== l.net) {
      errs.push(`line ${l.id}: taxable/tax do not match net`);
    }
    if (l.discount < 0 || l.discount > l.amount) errs.push(`line ${l.id}: discount out of range`);
  }
  for (const g of b.taxGroups) {
    if (g.cgst + g.sgst + g.igst !== g.tax) errs.push(`group ${g.rateBp}: CGST+SGST+IGST ≠ tax`);
    if (g.cgst - g.sgst > 1 || g.cgst < g.sgst) errs.push(`group ${g.rateBp}: uneven CGST/SGST split`);
  }
  if (b.taxable + b.totalTax + b.roundOff !== b.total) errs.push('taxable + tax + round-off ≠ total');
  if (b.taxable !== b.subtotal - b.discount + b.serviceCharge - (b.pricingMode === 'inclusive' ? sum(b.lines.map((l) => l.tax)) : 0)) {
    errs.push('taxable does not reconcile with subtotal − discount + service charge');
  }
  return errs;
}

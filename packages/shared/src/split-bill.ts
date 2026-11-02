// Split bills (docs/08 "Split bills", P2-05). The whole bill is calculated once (calculateBill); its per-line
// figures are shared out to the parts by weights, so nothing is taxed or discounted twice and the parts add up to
// the unsplit total exactly. Each part is rounded to the outlet's step; the round-off is spread in whole steps
// (decided 2026-11-02 with the product owner: "₹1,213 in 3 → 404 + 404 + 405").
import type { BillBreakup, BillLine, TaxGroup } from './bill-calc.js';
import { allocateLargestRemainder, sumPaise, type RoundOffStep } from './money.js';
import { splitCgstSgst } from './tax.js';

/** Line i → its weight in each part (equal: all 1; proportion: the weights; by item: the qty assigned). */
export type SplitWeights = number[][];

/** Shares `total` by `weights` (largest remainder); ties go to the later part (docs/08 "remainders to the last part"). */
function share(total: number, weights: number[]): number[] {
  if (total === 0) return weights.map(() => 0);
  return allocateLargestRemainder(total, [...weights].reverse()).reverse();
}

/**
 * Splits a whole bill into parts. Per line: net, discount, food tax, service charge and its tax are each shared
 * by the line's weights; the rest follows (amount = net + discount; taxable = net, or net − tax when prices
 * include GST). Totals are then rounded per part in steps so Σ part totals = whole total.
 */
export function splitBreakup(whole: BillBreakup, weights: SplitWeights, step: RoundOffStep, interState = false): BillBreakup[] {
  if (weights.length !== whole.lines.length) throw new RangeError('one weight row per bill line');
  const parts = weights[0]?.length ?? 0;
  if (parts < 2) throw new RangeError('a split needs at least 2 parts');
  const lines: BillLine[][] = Array.from({ length: parts }, () => []);

  whole.lines.forEach((l, i) => {
    const w = weights[i]!;
    if (w.length !== parts || w.some((x) => !Number.isSafeInteger(x) || x < 0) || w.every((x) => x === 0)) {
      throw new RangeError(`line ${l.id}: weights must be whole numbers, at least one above 0`);
    }
    const net = share(l.net, w);
    const discount = share(l.discount, w);
    const tax = share(l.tax, w);
    const sc = share(l.serviceCharge, w);
    const scTax = share(l.serviceChargeTax, w);
    for (let p = 0; p < parts; p++) {
      if (w[p] === 0) continue;
      lines[p]!.push({
        id: l.id,
        taxRateBp: l.taxRateBp,
        amount: net[p]! + discount[p]!,
        discount: discount[p]!,
        net: net[p]!,
        taxable: whole.pricingMode === 'inclusive' ? net[p]! - tax[p]! : net[p]!,
        tax: tax[p]!,
        serviceCharge: sc[p]!,
        serviceChargeTax: scTax[p]!,
      });
    }
  });

  const pre = lines.map((ls) => sumPaise(ls.flatMap((l) => [l.taxable, l.tax, l.serviceCharge, l.serviceChargeTax])));
  const totals = roundParts(pre, whole.total, step);

  return lines.map((ls, p) => {
    const groups = new Map<number, { taxable: number; tax: number }>();
    for (const l of ls) {
      const g = groups.get(l.taxRateBp) ?? { taxable: 0, tax: 0 };
      g.taxable += l.taxable + l.serviceCharge;
      g.tax += l.tax + l.serviceChargeTax;
      groups.set(l.taxRateBp, g);
    }
    const taxGroups: TaxGroup[] = [...groups.entries()].sort(([a], [b]) => a - b).map(([rateBp, g]) => ({ rateBp, ...g, ...splitCgstSgst(g.tax, interState) }));
    const taxable = sumPaise(taxGroups.map((g) => g.taxable));
    const totalTax = sumPaise(taxGroups.map((g) => g.tax));
    return {
      pricingMode: whole.pricingMode,
      lines: ls,
      subtotal: sumPaise(ls.map((l) => l.amount)),
      discount: sumPaise(ls.map((l) => l.discount)),
      serviceCharge: sumPaise(ls.map((l) => l.serviceCharge)),
      taxable,
      taxGroups,
      cgst: sumPaise(taxGroups.map((g) => g.cgst)),
      sgst: sumPaise(taxGroups.map((g) => g.sgst)),
      igst: sumPaise(taxGroups.map((g) => g.igst)),
      totalTax,
      roundOff: totals[p]! - pre[p]!,
      total: totals[p]!,
    };
  });
}

/**
 * Part totals in multiples of `step` that add up to `wholeTotal` (itself a multiple of the step): every part is
 * rounded down, then the steps still missing go to the parts with the largest remainders (later parts win ties,
 * docs/08 "remainders to the last part"). With no rounding (step 0) the parts keep their exact amounts.
 */
export function roundParts(pre: number[], wholeTotal: number, step: RoundOffStep): number[] {
  if (step === 0) return [...pre];
  const floors = pre.map((x) => Math.floor(x / step) * step);
  let missing = (wholeTotal - sumPaise(floors)) / step;
  if (!Number.isInteger(missing) || missing < 0 || missing > pre.length) throw new RangeError('part totals cannot reach the whole total');
  const order = pre.map((x, i) => ({ i, rem: x - floors[i]! })).sort((a, b) => b.rem - a.rem || b.i - a.i);
  const out = [...floors];
  for (const { i } of order) {
    if (missing === 0) break;
    out[i]! += step;
    missing--;
  }
  return out;
}

/** Weights for an equal split into n parts. */
export const equalWeights = (lines: number, n: number): SplitWeights => Array.from({ length: lines }, () => Array.from({ length: n }, () => 1));

/** The same weights for every line (proportion split, e.g. 2 : 1 : 1). */
export const proportionWeights = (lines: number, weights: number[]): SplitWeights => Array.from({ length: lines }, () => [...weights]);

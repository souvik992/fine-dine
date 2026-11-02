// GST helpers (docs/08-billing-gst.md). Integer paise and basis points only.
import { applyRate, assertNonNegative, BP_DENOMINATOR, mulDivRound } from './money.js';

export type PricingMode = 'exclusive' | 'inclusive';

export interface LineTax {
  /** Value the tax is charged on. */
  taxable: number;
  tax: number;
}

/**
 * Tax on one line amount.
 * - exclusive: tax = round(amount × rate / 10000); taxable = amount.
 * - inclusive: tax = round(amount × rate / (10000 + rate)); taxable = amount − tax.
 */
export function lineTax(amountPaise: number, rateBp: number, mode: PricingMode): LineTax {
  assertNonNegative(amountPaise, 'amount');
  assertNonNegative(rateBp, 'rateBp');
  if (mode === 'exclusive') return { taxable: amountPaise, tax: applyRate(amountPaise, rateBp) };
  const tax = mulDivRound(amountPaise, rateBp, BP_DENOMINATOR + rateBp);
  return { taxable: amountPaise - tax, tax };
}

export interface GstSplit {
  cgst: number;
  sgst: number;
  igst: number;
}

/** Intra-state: CGST and SGST halves, the odd paisa to CGST. Inter-state: all IGST. */
export function splitCgstSgst(taxPaise: number, interState = false): GstSplit {
  assertNonNegative(taxPaise, 'tax');
  if (interState) return { cgst: 0, sgst: 0, igst: taxPaise };
  const sgst = Math.floor(taxPaise / 2);
  return { cgst: taxPaise - sgst, sgst, igst: 0 };
}

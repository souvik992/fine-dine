// Column and number formatting for receipts. Integer paise / basis points in, text out.
import { formatINR } from '@dinepos/shared';

/** "1,23,456.78" (Indian grouping, no currency sign: thermal printers have no ₹ glyph in text mode). */
export const money = (paise: number): string => formatINR(paise, '');

/** "1680.00": plain rupees for a UPI amount. */
export function plainRupees(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError('amount must be a non-negative integer');
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** Basis points as a percentage without floats: 500 → "5", 250 → "2.5", 225 → "2.25". */
export function percent(bp: number): string {
  if (!Number.isSafeInteger(bp) || bp < 0) throw new RangeError('rate must be a non-negative integer');
  const whole = Math.floor(bp / 100);
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Half of a rate for the CGST/SGST label, kept exact: 500 → "2.5", 1800 → "9", 5 → "0.025". */
export function halfPercent(bp: number): string {
  if (bp % 2 === 0) return percent(bp / 2);
  const whole = Math.floor(bp / 200);
  const frac = String((bp % 200) * 5).padStart(3, '0').replace(/0+$/, '');
  return `${whole}.${frac}`;
}

export const padLeft = (s: string, w: number): string => (s.length >= w ? s : ' '.repeat(w - s.length) + s);
export const padRight = (s: string, w: number): string => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length));

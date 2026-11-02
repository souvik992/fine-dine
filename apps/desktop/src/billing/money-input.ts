// Parsing what the cashier types into integers (paise, basis points). No floating point anywhere.
import { parseRupees } from '@dinepos/shared';

/** "120", "120.5", "1,200.75" → paise; empty → 0; anything else → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.trim();
  if (!s) return 0;
  try {
    return parseRupees(s);
  } catch {
    return null;
  }
}

/** "10" → 1000, "12.5" → 1250, "2.25" → 225 (basis points); up to 100%. Empty → 0; invalid → null. */
export function percentToBp(input: string): number | null {
  const s = input.trim().replace(/%$/, '');
  if (!s) return 0;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** Paise as plain typed rupees, integer maths only: 38250 → "382.50". */
export function paiseToInput(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** Basis points as percentage text: 1000 → "10", 1250 → "12.5". */
export function bpToPercentText(bp: number): string {
  const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
  return frac ? `${Math.floor(bp / 100)}.${frac}` : String(Math.floor(bp / 100));
}

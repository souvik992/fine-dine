// Inventory units and quantity helpers (docs/02-domain-model.md "Stock").
// Quantities are integer thousandths of the material's unit (1.5 kg = 1500, 3 pieces = 3000), so no floats.
// Costs are integer paise per whole unit (₹123.45 per kg = 12345).
import { mulDivRound } from './money.js';

export const STOCK_UNITS = ['kg', 'g', 'l', 'ml', 'pcs'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];

export const UNIT_LABELS: Record<StockUnit, string> = { kg: 'kg', g: 'g', l: 'litre', ml: 'ml', pcs: 'pcs' };

/** Largest quantity accepted anywhere: a million million thousandths, far below 2^53. */
export const MAX_QTY_MILLI = 1_000_000_000_000;

/** Parses typed quantities ("2", "2.5", "0.125", "-1.5" when `allowNegative`) into thousandths. Null if invalid. */
export function parseQty(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  const m = /^(-?)(\d{1,12})(?:\.(\d{1,3}))?$/.exec(input.trim().replace(/,/g, ''));
  if (!m || (m[1] && !opts.allowNegative)) return null;
  const milli = Number(m[2]) * 1000 + Number((m[3] ?? '').padEnd(3, '0'));
  if (milli > MAX_QTY_MILLI) return null;
  return m[1] && milli !== 0 ? -milli : milli;
}

/** 2500 → "2.5", -1250 → "-1.25", 3000 → "3". */
export function formatQty(milli: number): string {
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${milli < 0 ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** 2500, 'kg' → "2.5 kg". */
export function formatStockQty(milli: number, unit: StockUnit): string {
  return `${formatQty(milli)} ${UNIT_LABELS[unit]}`;
}

/** Cost of `qtyMilli` at `unitCostPaise` per whole unit, rounded half up. */
export function stockAmount(qtyMilli: number, unitCostPaise: number): number {
  return mulDivRound(qtyMilli, unitCostPaise, 1000);
}

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatQty, formatStockQty, parseQty, stockAmount } from './stock.js';

describe('stock quantities', () => {
  it('parses typed quantities into thousandths without floats', () => {
    expect(parseQty('2')).toBe(2000);
    expect(parseQty('2.5')).toBe(2500);
    expect(parseQty('0.125')).toBe(125);
    expect(parseQty(' 1,250.5 ')).toBe(1_250_500);
    expect(parseQty('-1.5')).toBeNull();
    expect(parseQty('-1.5', { allowNegative: true })).toBe(-1500);
    for (const bad of ['', 'abc', '1.2345', '1e3', '.5', '1.']) expect(parseQty(bad), bad).toBeNull();
  });

  it('formats without trailing zeros, and round-trips', () => {
    expect(formatQty(2500)).toBe('2.5');
    expect(formatQty(3000)).toBe('3');
    expect(formatQty(-1250)).toBe('-1.25');
    expect(formatQty(5)).toBe('0.005');
    expect(formatStockQty(1500, 'l')).toBe('1.5 litre');
    fc.assert(fc.property(fc.integer({ min: -1e12, max: 1e12 }), (n) => parseQty(formatQty(n), { allowNegative: true }) === n));
  });

  it('values stock half up in integer paise', () => {
    expect(stockAmount(2500, 32_050)).toBe(80_125);
    expect(stockAmount(333, 15_000)).toBe(4995);
    expect(stockAmount(1, 500)).toBe(1); // 0.5 paise rounds up
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lineTax, splitCgstSgst } from './tax.js';

describe('lineTax', () => {
  it('exclusive: tax on top of the amount', () => {
    expect(lineTax(10_000, 500, 'exclusive')).toEqual({ taxable: 10_000, tax: 500 });
    expect(lineTax(10_010, 500, 'exclusive')).toEqual({ taxable: 10_010, tax: 501 }); // 500.5 → 501
  });

  it('inclusive: tax = round(amount × rate / (10000 + rate)), taxable is the rest', () => {
    expect(lineTax(10_500, 500, 'inclusive')).toEqual({ taxable: 10_000, tax: 500 });
    expect(lineTax(11_800, 1800, 'inclusive')).toEqual({ taxable: 10_000, tax: 1_800 });
    expect(lineTax(100, 500, 'inclusive')).toEqual({ taxable: 95, tax: 5 }); // 4.76 → 5
  });

  it('zero rate means no tax', () => {
    expect(lineTax(12_345, 0, 'exclusive')).toEqual({ taxable: 12_345, tax: 0 });
    expect(lineTax(12_345, 0, 'inclusive')).toEqual({ taxable: 12_345, tax: 0 });
  });

  it('rejects negatives and floats', () => {
    expect(() => lineTax(-1, 500, 'exclusive')).toThrow(RangeError);
    expect(() => lineTax(100, 2.5, 'exclusive')).toThrow(RangeError);
  });

  it('property: inclusive taxable + tax = amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), fc.integer({ min: 0, max: 4000 }), (amt, rate) => {
        const t = lineTax(amt, rate, 'inclusive');
        expect(t.taxable + t.tax).toBe(amt);
        expect(t.tax).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe('splitCgstSgst', () => {
  it('halves the tax, odd paisa to CGST', () => {
    expect(splitCgstSgst(500)).toEqual({ cgst: 250, sgst: 250, igst: 0 });
    expect(splitCgstSgst(505)).toEqual({ cgst: 253, sgst: 252, igst: 0 });
    expect(splitCgstSgst(1)).toEqual({ cgst: 1, sgst: 0, igst: 0 });
  });

  it('inter-state tax is all IGST', () => {
    expect(splitCgstSgst(505, true)).toEqual({ cgst: 0, sgst: 0, igst: 505 });
  });
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateBill, checkBillInvariants, lineAmount, type BillLineInput, type BillOptions } from './bill-calc.js';

const paneer: BillLineInput = { id: 'paneer', qty: 2, unitPricePaise: 32_000, taxRateBp: 500 };
const naan: BillLineInput = { id: 'naan', qty: 4, unitPricePaise: 6_000, taxRateBp: 500 };
const mocktail: BillLineInput = { id: 'mocktail', qty: 1, unitPricePaise: 18_000, taxRateBp: 1800 };

describe('lineAmount', () => {
  it('is unit price × qty + Σ addon price × addon qty', () => {
    expect(lineAmount({ id: 'a', qty: 2, unitPricePaise: 25_000, taxRateBp: 500, addons: [{ qty: 2, pricePaise: 3_000 }] })).toBe(56_000);
  });

  it('rejects non-positive or fractional quantities', () => {
    expect(() => lineAmount({ ...paneer, qty: 0 })).toThrow(/qty/);
    expect(() => lineAmount({ ...paneer, qty: 1.5 })).toThrow(/qty/);
  });
});

describe('calculateBill — worked example (exclusive)', () => {
  // Paneer 2 × ₹320, Naan 4 × ₹60 at 5%; Mocktail ₹180 at 18%. 10% discount, 10% service charge.
  const bill = calculateBill([paneer, naan, mocktail], {
    discount: { kind: 'pct', valueBp: 1000 },
    serviceChargeBp: 1000,
  });

  it('allocates the discount pro rata', () => {
    expect(bill.subtotal).toBe(106_000);
    expect(bill.discount).toBe(10_600);
    expect(bill.lines.map((l) => l.discount)).toEqual([6_400, 2_400, 1_800]);
  });

  it('charges service on the discounted value and taxes each share at its line rate', () => {
    expect(bill.serviceCharge).toBe(9_540);
    expect(bill.lines.map((l) => l.serviceCharge)).toEqual([5_760, 2_160, 1_620]);
    expect(bill.lines.map((l) => l.serviceChargeTax)).toEqual([288, 108, 292]); // 291.6 → 292
  });

  it('groups GST by rate and splits CGST/SGST', () => {
    expect(bill.taxGroups).toEqual([
      { rateBp: 500, taxable: 87_120, tax: 4_356, cgst: 2_178, sgst: 2_178, igst: 0 },
      { rateBp: 1800, taxable: 17_820, tax: 3_208, cgst: 1_604, sgst: 1_604, igst: 0 },
    ]);
  });

  it('rounds the total to the rupee as its own line', () => {
    expect(bill.taxable).toBe(104_940);
    expect(bill.totalTax).toBe(7_564);
    expect(bill.roundOff).toBe(-4);
    expect(bill.total).toBe(112_500);
    expect(checkBillInvariants(bill)).toEqual([]);
  });
});

describe('calculateBill — rules', () => {
  it('odd paisa of a rate group goes to CGST', () => {
    const b = calculateBill([{ id: 'x', qty: 1, unitPricePaise: 10_100, taxRateBp: 500 }], { roundOffStep: 0 });
    expect(b.taxGroups[0]).toMatchObject({ tax: 505, cgst: 253, sgst: 252 });
    expect(b.total).toBe(10_605);
  });

  it('inter-state bills use IGST', () => {
    const b = calculateBill([paneer], { interState: true });
    expect(b).toMatchObject({ cgst: 0, sgst: 0, igst: 3_200 });
  });

  it('a fixed-amount discount is spread exactly', () => {
    const b = calculateBill([{ id: 'a', qty: 1, unitPricePaise: 100, taxRateBp: 500 }, { id: 'b', qty: 1, unitPricePaise: 100, taxRateBp: 500 }, { id: 'c', qty: 1, unitPricePaise: 100, taxRateBp: 500 }], {
      discount: { kind: 'amount', valuePaise: 100 },
    });
    expect(b.lines.map((l) => l.discount)).toEqual([34, 33, 33]);
  });

  it('service charge on a 0% line carries no GST', () => {
    const b = calculateBill(
      [
        { id: 'food', qty: 1, unitPricePaise: 10_000, taxRateBp: 500 },
        { id: 'liquor', qty: 1, unitPricePaise: 10_000, taxRateBp: 0 },
      ],
      { serviceChargeBp: 1000, roundOffStep: 0 },
    );
    expect(b.lines.map((l) => [l.serviceCharge, l.serviceChargeTax])).toEqual([[1_000, 50], [1_000, 0]]);
    expect(b.total).toBe(20_000 + 500 + 2_000 + 50);
  });

  it('inclusive pricing extracts GST from the menu price', () => {
    const b = calculateBill([{ id: 'x', qty: 2, unitPricePaise: 10_500, taxRateBp: 500 }], { pricingMode: 'inclusive' });
    expect(b.lines[0]).toMatchObject({ amount: 21_000, taxable: 20_000, tax: 1_000 });
    expect(b.total).toBe(21_000);
  });

  it('inclusive pricing charges service on the pre-GST value, taxed on top', () => {
    const b = calculateBill([{ id: 'x', qty: 1, unitPricePaise: 10_500, taxRateBp: 500 }], {
      pricingMode: 'inclusive',
      serviceChargeBp: 1000,
      roundOffStep: 0,
    });
    expect(b.serviceCharge).toBe(1_000);
    expect(b.lines[0]!.serviceChargeTax).toBe(50);
    expect(b.total).toBe(10_500 + 1_000 + 50);
    expect(checkBillInvariants(b)).toEqual([]);
  });

  it('round-off tie is configurable', () => {
    const line = [{ id: 'x', qty: 1, unitPricePaise: 10_150, taxRateBp: 0 }];
    expect(calculateBill(line, { roundOffTie: 'up' }).total).toBe(10_200);
    expect(calculateBill(line, { roundOffTie: 'down' }).total).toBe(10_100);
    expect(calculateBill(line, { roundOffStep: 50 }).total).toBe(10_150);
  });

  it('an empty bill is all zeros', () => {
    expect(calculateBill([])).toMatchObject({ subtotal: 0, totalTax: 0, total: 0, taxGroups: [] });
  });

  it('rejects impossible discounts and duplicate lines', () => {
    expect(() => calculateBill([paneer], { discount: { kind: 'amount', valuePaise: 64_001 } })).toThrow(/exceeds/);
    expect(() => calculateBill([paneer], { discount: { kind: 'pct', valueBp: 10_001 } })).toThrow(/100%/);
    expect(() => calculateBill([paneer, paneer])).toThrow(/duplicate/);
  });
});

// ---------- property tests ----------

const lineArb = (i: number) =>
  fc.record({
    id: fc.constant(`l${i}`),
    qty: fc.integer({ min: 1, max: 50 }),
    unitPricePaise: fc.integer({ min: 0, max: 500_000 }),
    taxRateBp: fc.constantFrom(0, 500, 1200, 1800, 2800),
    addons: fc.array(fc.record({ qty: fc.integer({ min: 0, max: 5 }), pricePaise: fc.integer({ min: 0, max: 20_000 }) }), { maxLength: 3 }),
  });

const linesArb = fc.integer({ min: 0, max: 25 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => lineArb(i))));

const optsArb = (subtotal: number): fc.Arbitrary<BillOptions> =>
  fc.record({
    pricingMode: fc.constantFrom('exclusive' as const, 'inclusive' as const),
    interState: fc.boolean(),
    discount: fc.oneof(
      fc.constant(null),
      fc.integer({ min: 0, max: 10_000 }).map((valueBp) => ({ kind: 'pct' as const, valueBp })),
      fc.integer({ min: 0, max: subtotal }).map((valuePaise) => ({ kind: 'amount' as const, valuePaise })),
    ),
    serviceChargeBp: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 2000 })),
    roundOffStep: fc.constantFrom(0 as const, 50 as const, 100 as const),
    roundOffTie: fc.constantFrom('up' as const, 'down' as const),
  });

describe('calculateBill — properties', () => {
  it('every random bill adds up and contains only integers', () => {
    fc.assert(
      fc.property(
        linesArb.chain((lines) => fc.tuple(fc.constant(lines), optsArb(lines.reduce((s, l) => s + lineAmount(l), 0)))),
        ([lines, opts]) => {
          const b = calculateBill(lines, opts);
          expect(checkBillInvariants(b)).toEqual([]);
          expect(Math.abs(b.roundOff)).toBeLessThanOrEqual((opts.roundOffStep ?? 100) / 2);
          expect(b.total).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it('exclusive line tax is exactly round(net × rate / 10000), per docs/08 step 5', () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        const b = calculateBill(lines, { discount: { kind: 'pct', valueBp: 1250 } });
        for (const l of b.lines) {
          const exact = (BigInt(l.net) * BigInt(l.taxRateBp) * 2n + 10_000n) / 20_000n;
          expect(BigInt(l.tax)).toBe(exact);
        }
      }),
    );
  });

  it('checkBillInvariants catches a float or a tampered total', () => {
    const b = calculateBill([paneer, naan]);
    expect(checkBillInvariants({ ...b, total: b.total + 1 })).toContain('taxable + tax + round-off ≠ total');
    expect(checkBillInvariants({ ...b, cgst: 0.5 }).some((e) => e.includes('not a safe integer'))).toBe(true);
  });
});

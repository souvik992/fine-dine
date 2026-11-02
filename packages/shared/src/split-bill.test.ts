import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateBill, checkBillInvariants, type BillLineInput } from './bill-calc.js';
import { equalWeights, proportionWeights, roundParts, splitBreakup, type SplitWeights } from './split-bill.js';

const lines: BillLineInput[] = [
  { id: 'pt', qty: 2, unitPricePaise: 32_000, taxRateBp: 500 },
  { id: 'bn', qty: 4, unitPricePaise: 6_000, taxRateBp: 500, addons: [{ qty: 1, pricePaise: 3_000 }] },
  { id: 'bar', qty: 1, unitPricePaise: 45_000, taxRateBp: 0 },
];

describe('split bills', () => {
  it('equal: ₹ parts are rounded to the step and add up exactly; remainders go to the last part', () => {
    const whole = calculateBill(lines, { serviceChargeBp: 1000, discount: { kind: 'pct', valueBp: 1000 } });
    const parts = splitBreakup(whole, equalWeights(lines.length, 3), 100);
    expect(parts.reduce((s, p) => s + p.total, 0)).toBe(whole.total);
    for (const p of parts) {
      expect(p.total % 100).toBe(0);
      expect(checkBillInvariants(p)).toEqual([]);
    }
    expect(parts[2]!.total).toBeGreaterThanOrEqual(parts[0]!.total);
  });

  it('by item: each part carries only its lines, with the same per-line tax as the whole bill', () => {
    const whole = calculateBill(lines, {});
    const w: SplitWeights = [
      [2, 0],
      [0, 4],
      [1, 0],
    ];
    const [a, b] = splitBreakup(whole, w, 100);
    expect(a!.lines.map((l) => l.id)).toEqual(['pt', 'bar']);
    expect(b!.lines.map((l) => l.id)).toEqual(['bn']);
    expect(b!.lines[0]!.tax).toBe(whole.lines[1]!.tax);
    expect(a!.total + b!.total).toBe(whole.total);
  });

  it('a partial quantity of a line is shared by quantity (2 of 3 portions)', () => {
    const whole = calculateBill([{ id: 'x', qty: 3, unitPricePaise: 10_000, taxRateBp: 500 }], { roundOffStep: 0 });
    const [a, b] = splitBreakup(whole, [[2, 1]], 0);
    expect([a!.subtotal, b!.subtotal]).toEqual([20_000, 10_000]);
  });

  it('refuses fewer than 2 parts, a line with no part, or fractional weights', () => {
    const whole = calculateBill(lines, {});
    expect(() => splitBreakup(whole, proportionWeights(3, [1]), 100)).toThrow(/at least 2/);
    expect(() => splitBreakup(whole, [[1, 0], [0, 0], [1, 1]], 100)).toThrow(/at least one/);
    expect(() => splitBreakup(whole, proportionWeights(3, [1.5, 1]), 100)).toThrow(/whole numbers/);
  });

  it('round-off steps go to the largest remainders, later parts first on ties', () => {
    expect(roundParts([40_433, 40_433, 40_434], 121_300, 100)).toEqual([40_400, 40_400, 40_500]);
    expect(roundParts([10_050, 10_050], 20_100, 100)).toEqual([10_000, 10_100]);
    expect(roundParts([10_049, 10_051], 20_100, 0)).toEqual([10_049, 10_051]);
  });

  // P2-05 acceptance: Σ parts = total for 1,000 random orders, in every mode, and every part is a valid bill.
  it('property: for 1,000 random orders and splits, parts add up to the unsplit total exactly', () => {
    const line = fc.record({
      qty: fc.integer({ min: 1, max: 12 }),
      unitPricePaise: fc.integer({ min: 0, max: 300_000 }),
      taxRateBp: fc.constantFrom(0, 500, 1200, 1800, 2800),
      addons: fc.array(fc.record({ qty: fc.integer({ min: 1, max: 3 }), pricePaise: fc.integer({ min: 0, max: 20_000 }) }), { maxLength: 2 }),
    });
    const order = fc.record({
      lines: fc.array(line, { minLength: 1, maxLength: 12 }),
      pricingMode: fc.constantFrom('exclusive' as const, 'inclusive' as const),
      discountBp: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 10_000 })),
      serviceChargeBp: fc.constantFrom(0, 500, 1000),
      step: fc.constantFrom(0 as const, 50 as const, 100 as const),
      tie: fc.constantFrom('up' as const, 'down' as const),
      parts: fc.integer({ min: 2, max: 8 }),
      mode: fc.constantFrom('equal', 'proportion', 'items'),
      seed: fc.array(fc.integer({ min: 0, max: 7 }), { minLength: 12, maxLength: 12 }),
      ratios: fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 8, maxLength: 8 }),
    });
    fc.assert(
      fc.property(order, (o) => {
        const input = o.lines.map((l, i) => ({ id: `l${i}`, ...l }));
        const whole = calculateBill(input, {
          pricingMode: o.pricingMode,
          discount: o.discountBp ? { kind: 'pct', valueBp: o.discountBp } : null,
          serviceChargeBp: o.serviceChargeBp,
          roundOffStep: o.step,
          roundOffTie: o.tie,
        });
        const weights: SplitWeights =
          o.mode === 'equal'
            ? equalWeights(input.length, o.parts)
            : o.mode === 'proportion'
              ? proportionWeights(input.length, o.ratios.slice(0, o.parts))
              : input.map((l, i) => Array.from({ length: o.parts }, (_, p) => (p === o.seed[i]! % o.parts ? l.qty : 0)));
        const parts = splitBreakup(whole, weights, o.step);
        const sum = (f: (b: (typeof parts)[number]) => number) => parts.reduce((s, p) => s + f(p), 0);
        expect(sum((p) => p.total)).toBe(whole.total);
        expect(sum((p) => p.totalTax)).toBe(whole.totalTax);
        expect(sum((p) => p.discount)).toBe(whole.discount);
        expect(sum((p) => p.serviceCharge)).toBe(whole.serviceCharge);
        for (const p of parts) {
          expect(checkBillInvariants(p)).toEqual([]);
          if (o.step) expect(p.total % o.step).toBe(0);
          expect(Math.abs(p.roundOff)).toBeLessThanOrEqual(o.step);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

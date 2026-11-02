import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateLargestRemainder,
  applyRate,
  formatINR,
  mulDivRound,
  multiplyPaise,
  parseRupees,
  roundHalfUp,
  roundOff,
  sumPaise,
} from './money.js';

describe('roundHalfUp', () => {
  it('rounds halves up and everything else to nearest', () => {
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(7, 3)).toBe(2);
    expect(roundHalfUp(8, 3)).toBe(3);
    expect(roundHalfUp(10, 5)).toBe(2);
  });

  it('rounds negative halves away from zero (refund mirrors sale)', () => {
    expect(roundHalfUp(-5, 2)).toBe(-3);
    expect(roundHalfUp(-7, 3)).toBe(-2);
  });

  it('rejects floats and a non-positive denominator', () => {
    expect(() => roundHalfUp(1.5, 2)).toThrow(RangeError);
    expect(() => roundHalfUp(1, 0)).toThrow(RangeError);
  });
});

describe('mulDivRound / applyRate', () => {
  it('does not overflow on large intermediates', () => {
    // ₹1 crore × 28% → the product exceeds 2^53 only through BigInt-safe paths.
    expect(mulDivRound(9_000_000_000_000, 2800, 10_000)).toBe(2_520_000_000_000);
  });

  it('applies basis-point rates with half-up rounding', () => {
    expect(applyRate(10_100, 500)).toBe(505);
    expect(applyRate(1, 5000)).toBe(1); // 0.5 paisa → 1
    expect(applyRate(1, 4999)).toBe(0);
  });

  it('refuses results beyond safe integers', () => {
    expect(() => multiplyPaise(Number.MAX_SAFE_INTEGER, 2)).toThrow(/overflows/);
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, 1])).toThrow(/overflows/);
  });
});

describe('allocateLargestRemainder', () => {
  it('gives leftover paise to the largest remainders, ties to the lowest index', () => {
    expect(allocateLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateLargestRemainder(10, [3, 3, 4])).toEqual([3, 3, 4]);
    expect(allocateLargestRemainder(7, [1, 2])).toEqual([2, 5]);
  });

  it('handles zero weights, zero total and negatives', () => {
    expect(allocateLargestRemainder(5, [0, 1, 0])).toEqual([0, 5, 0]);
    expect(allocateLargestRemainder(0, [0, 0])).toEqual([0, 0]);
    expect(allocateLargestRemainder(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(() => allocateLargestRemainder(1, [0, 0])).toThrow(/sum to zero/);
    expect(() => allocateLargestRemainder(1, [-1, 2])).toThrow(/negative/);
  });

  it('property: allocation always sums to total, each part within 1 paisa of its exact share', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000_000, max: 10_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000_000 }), { minLength: 1, maxLength: 40 }).filter((w) => w.some((x) => x > 0)),
        (total, weights) => {
          const parts = allocateLargestRemainder(total, weights);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          const W = BigInt(weights.reduce((a, b) => a + b, 0));
          parts.forEach((p, i) => {
            expect(Number.isSafeInteger(p)).toBe(true);
            const exactFloor = (BigInt(Math.abs(total)) * BigInt(weights[i]!)) / W;
            const absP = BigInt(Math.abs(p));
            expect(absP === exactFloor || absP === exactFloor + 1n).toBe(true);
            if (weights[i] === 0) expect(p).toBe(0);
          });
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe('roundOff', () => {
  it('rounds to the rupee with a configurable tie', () => {
    expect(roundOff(10_149, 100)).toBe(-49);
    expect(roundOff(10_151, 100)).toBe(49);
    expect(roundOff(10_150, 100, 'up')).toBe(50);
    expect(roundOff(10_150, 100, 'down')).toBe(-50);
    expect(roundOff(10_100, 100)).toBe(0);
  });

  it('rounds to 50 paise and can be switched off', () => {
    expect(roundOff(10_125, 50, 'up')).toBe(25);
    expect(roundOff(10_125, 50, 'down')).toBe(-25);
    expect(roundOff(10_130, 50)).toBe(20);
    expect(roundOff(10_123, 0)).toBe(0);
  });

  it('property: adjusted amount is a multiple of the step, |adjustment| ≤ step/2', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.constantFrom(50 as const, 100 as const),
        fc.constantFrom('up' as const, 'down' as const),
        (amount, step, tie) => {
          const adj = roundOff(amount, step, tie);
          expect((amount + adj) % step === 0).toBe(true);
          expect(Math.abs(adj)).toBeLessThanOrEqual(step / 2);
        },
      ),
    );
  });
});

describe('formatINR / parseRupees', () => {
  it('formats with Indian grouping', () => {
    expect(formatINR(12_345_678)).toBe('₹1,23,456.78');
    expect(formatINR(5)).toBe('₹0.05');
    expect(formatINR(-100_000)).toBe('-₹1,000.00');
    expect(formatINR(99_999, 'Rs ')).toBe('Rs 999.99');
  });

  it('parses typed rupees without floats', () => {
    expect(parseRupees('120')).toBe(12_000);
    expect(parseRupees('120.5')).toBe(12_050);
    expect(parseRupees(' 1,20,000.75 ')).toBe(12_000_075);
    expect(() => parseRupees('12.345')).toThrow(RangeError);
    expect(() => parseRupees('-5')).toThrow(RangeError);
  });

  it('property: parse(format(x)) round-trips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_000 }), (p) => {
        expect(parseRupees(formatINR(p, ''))).toBe(p);
      }),
    );
  });
});

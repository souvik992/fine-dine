import { describe, expect, it } from 'vitest';
import { deriveTableState } from './table-state.js';

const active = { status: 'active' as const };

describe('deriveTableState (checks in docs/02 order)', () => {
  it('1. blocked wins over everything', () => {
    expect(deriveTableState({ status: 'blocked' }, { hasFiredKot: true })).toBe('BLOCKED');
  });

  it('2. reserved with no open order', () => {
    expect(deriveTableState({ status: 'reserved' }, null)).toBe('RESERVED');
  });

  it('3. no open order is FREE', () => {
    expect(deriveTableState(active, null)).toBe('FREE');
  });

  it('4. open order with no fired KOT is SEATED (also on a reserved table)', () => {
    expect(deriveTableState(active, { hasFiredKot: false })).toBe('SEATED');
    expect(deriveTableState({ status: 'reserved' }, { hasFiredKot: false })).toBe('SEATED');
  });

  it('5. fired KOT and no bill, or a KOT after the bill, is KOT_RUNNING', () => {
    expect(deriveTableState(active, { hasFiredKot: true, lastKotAt: '2026-11-02T14:00:00Z' })).toBe('KOT_RUNNING');
    expect(
      deriveTableState(active, { hasFiredKot: true, lastKotAt: '2026-11-02T15:00:00Z', billPrintedAt: '2026-11-02T14:30:00Z' }),
    ).toBe('KOT_RUNNING');
  });

  it('6. otherwise BILL_PRINTED', () => {
    expect(
      deriveTableState(active, { hasFiredKot: true, lastKotAt: '2026-11-02T14:00:00Z', billPrintedAt: '2026-11-02T14:30:00Z' }),
    ).toBe('BILL_PRINTED');
  });

  it('5b. the kitchen screens say the food is done: FOOD_READY while some waits at the pass, then SERVED', () => {
    const kot = { hasFiredKot: true, lastKotAt: '2026-11-02T14:00:00Z' };
    const k = (cooking: number, ready: number, served: number, unknown = 0) => ({ ...kot, kitchen: { cooking, ready, served, unknown } });
    expect(deriveTableState(active, k(1, 1, 0))).toBe('KOT_RUNNING'); // something still cooking
    expect(deriveTableState(active, k(0, 1, 2))).toBe('FOOD_READY');
    expect(deriveTableState(active, k(0, 0, 3))).toBe('SERVED');
    expect(deriveTableState(active, k(0, 0, 3, 1))).toBe('KOT_RUNNING'); // a ticket at a station without a screen: unknown
    expect(deriveTableState(active, k(0, 0, 0, 0))).toBe('KOT_RUNNING'); // no ticket the screens know of
    expect(deriveTableState(active, { ...k(0, 0, 3), billPrintedAt: '2026-11-02T14:30:00Z' })).toBe('BILL_PRINTED'); // the bill wins
    expect(deriveTableState(active, { ...k(1, 0, 3), billPrintedAt: '2026-11-02T13:30:00Z' })).toBe('KOT_RUNNING'); // more food after the bill
  });

  it('compares instants, not strings with different offsets', () => {
    // 20:00+05:30 is 14:30Z, which is after 14:00Z.
    expect(
      deriveTableState(active, { hasFiredKot: true, lastKotAt: '2026-11-02T14:00:00Z', billPrintedAt: '2026-11-02T20:00:00+05:30' }),
    ).toBe('BILL_PRINTED');
  });
});

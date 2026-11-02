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

  it('compares instants, not strings with different offsets', () => {
    // 20:00+05:30 is 14:30Z, which is after 14:00Z.
    expect(
      deriveTableState(active, { hasFiredKot: true, lastKotAt: '2026-11-02T14:00:00Z', billPrintedAt: '2026-11-02T20:00:00+05:30' }),
    ).toBe('BILL_PRINTED');
  });
});

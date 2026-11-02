import { describe, expect, it } from 'vitest';
import { gstinCheckChar, gstinProblem } from './gstin.js';
import { financialYearAt, financialYearOf, formatBillNo } from './numbering.js';

describe('financial year', () => {
  it('runs 1 April to 31 March', () => {
    expect(financialYearOf('2026-11-02')).toBe('26-27');
    expect(financialYearOf('2027-03-31')).toBe('26-27');
    expect(financialYearOf('2027-04-01')).toBe('27-28');
    expect(financialYearOf('2099-12-31')).toBe('99-00');
  });

  it('uses the print date in the outlet zone (00:30 IST on 1 April is the new year)', () => {
    expect(financialYearAt(new Date('2027-03-31T19:00:00Z'), 'Asia/Kolkata')).toBe('27-28'); // 00:30 IST 1 Apr
    expect(financialYearAt(new Date('2027-03-31T18:00:00Z'), 'Asia/Kolkata')).toBe('26-27'); // 23:30 IST 31 Mar
  });
});

describe('formatBillNo', () => {
  it('formats prefix/FY/six digits within 16 characters', () => {
    expect(formatBillNo('B', '26-27', 123)).toBe('B/26-27/000123');
    expect(formatBillNo('T1', '26-27', 999_999)).toBe('T1/26-27/999999');
    expect(formatBillNo('ABC', '26-27', 1)).toHaveLength(16);
  });

  it('refuses prefixes and numbers that would break the GST limit', () => {
    expect(() => formatBillNo('ABCD', '26-27', 1)).toThrow(/prefix/);
    expect(() => formatBillNo('b', '26-27', 1)).toThrow(/prefix/);
    expect(() => formatBillNo('B', '26-27', 0)).toThrow(/range/);
    expect(() => formatBillNo('B', '2026', 1)).toThrow(/financial year/);
  });
});

describe('gstinProblem', () => {
  const valid = `27AAPFU0939F1Z${gstinCheckChar('27AAPFU0939F1Z')}`;
  it('accepts a GSTIN with a correct check character', () => {
    expect(gstinProblem(valid)).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 characters/);
    expect(gstinProblem(valid.toLowerCase())).toMatch(/capital/);
    expect(gstinProblem('99AAPFU0939F1ZV')).toMatch(/state code/);
    const typo = valid.slice(0, 14) + (valid[14] === 'A' ? 'B' : 'A');
    expect(gstinProblem(typo)).toMatch(/typo/);
  });
});

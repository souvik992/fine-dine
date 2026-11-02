import { describe, expect, it } from 'vitest';
import { addDays, isIsoDate, isoInZone, isValidTimeZone, localDate } from './time.js';

describe('localDate', () => {
  it('uses the outlet zone, not UTC', () => {
    // 20:00 UTC on 1 Nov is already 2 Nov in India.
    const at = new Date('2026-11-01T20:00:00Z');
    expect(localDate(at, 'Asia/Kolkata')).toBe('2026-11-02');
    expect(localDate(at, 'UTC')).toBe('2026-11-01');
  });
});

describe('isoInZone', () => {
  it('writes the zone offset', () => {
    const at = new Date('2026-11-02T14:44:05.120Z');
    expect(isoInZone(at, 'Asia/Kolkata')).toBe('2026-11-02T20:14:05.120+05:30');
    expect(isoInZone(at, 'UTC')).toBe('2026-11-02T14:44:05.120+00:00');
  });

  it('handles negative offsets', () => {
    expect(isoInZone(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(
      '2026-01-15T07:00:00.000-05:00',
    );
  });

  it('round-trips to the same instant', () => {
    const at = new Date('2026-03-29T01:30:00.999Z');
    expect(new Date(isoInZone(at, 'Europe/London')).getTime()).toBe(at.getTime());
  });
});

describe('date helpers', () => {
  it('validates zones and dates', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-1-01')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => addDays('bad', 1)).toThrow(RangeError);
  });
});

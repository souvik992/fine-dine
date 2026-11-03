import { describe, expect, it } from 'vitest';
import { toInstant, waitClass } from './bookings-model.js';

describe('bookings screen helpers', () => {
  it('a date and time on this terminal become the same instant', () => {
    const iso = toInstant('2026-11-03', '19:30');
    const back = new Date(iso);
    expect([back.getFullYear(), back.getMonth() + 1, back.getDate(), back.getHours(), back.getMinutes()]).toEqual([2026, 11, 3, 19, 30]);
    expect(iso.endsWith('Z')).toBe(true);
  });

  it('waiting longer than told turns red; the last five minutes amber', () => {
    expect(waitClass({ waitedMin: 21, quotedMin: 20 })).toBe('text-danger');
    expect(waitClass({ waitedMin: 16, quotedMin: 20 })).toBe('text-warn');
    expect(waitClass({ waitedMin: 5, quotedMin: 20 })).toBe('');
    expect(waitClass({ waitedMin: 50 })).toBe('');
  });
});

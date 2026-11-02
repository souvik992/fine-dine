import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { base64ToBytes, billDisplaySchema, billLogoSchema, bytesToBase64, DEFAULT_BILL_DISPLAY } from './bill-display.js';

describe('bill display settings', () => {
  it('defaults reproduce the standard bill; older partial values fill in', () => {
    expect(DEFAULT_BILL_DISPLAY).toMatchObject({ nameSize: 'large', headerLines: [], showCaptain: true, showRate: true, showItemCount: false });
    expect(billDisplaySchema.parse({ showCaptain: false })).toEqual({ ...DEFAULT_BILL_DISPLAY, showCaptain: false });
    expect(billDisplaySchema.safeParse({ hideGstin: true }).success).toBe(false); // legal fields are not options
    expect(billDisplaySchema.safeParse({ headerLines: ['a', 'b', 'c'] }).success).toBe(false);
  });

  it('base64 round-trips any bytes, like the standard encoding', () => {
    expect(bytesToBase64(new Uint8Array([0xff, 0x00, 0x81]))).toBe('/wCB');
    expect(bytesToBase64(new Uint8Array([1, 2]))).toBe('AQI=');
    fc.assert(fc.property(fc.uint8Array({ maxLength: 300 }), (b) => base64ToBytes(bytesToBase64(b)).join() === b.join()));
    expect(() => base64ToBytes('a!b')).toThrow();
  });

  it('a logo must match its size and not be blank', () => {
    const bits = (n: number, v = 0xff) => bytesToBase64(new Uint8Array(n).fill(v));
    expect(billLogoSchema.safeParse({ width: 16, height: 8, bits: bits(16) }).success).toBe(true);
    expect(billLogoSchema.safeParse({ width: 16, height: 8, bits: bits(15) }).success).toBe(false);
    expect(billLogoSchema.safeParse({ width: 16, height: 8, bits: bits(16, 0) }).success).toBe(false);
    expect(billLogoSchema.safeParse({ width: 12, height: 8, bits: bits(12) }).success).toBe(false); // width in steps of 8
    expect(billLogoSchema.safeParse({ width: 392, height: 8, bits: bits(49 * 8) }).success).toBe(false); // wider than 58 mm
  });
});

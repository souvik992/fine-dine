import { describe, expect, it } from 'vitest';
import { fitLogo, toMono, trimRows } from './logo.js';

const rgba = (w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(px(x, y), (y * w + x) * 4);
  return a;
};

describe('bill logo conversion', () => {
  it('fits inside the paper and the height limit, in steps of 8 dots, keeping the shape', () => {
    expect(fitLogo(1000, 500, 384)).toEqual({ width: 384, height: 192 });
    expect(fitLogo(100, 1000, 384)).toEqual({ width: 24, height: 240 });
    expect(fitLogo(50, 20, 384)).toEqual({ width: 48, height: 19 }); // never enlarged
  });

  it('dark pixels print, light and transparent ones do not; MSB first', () => {
    const img = rgba(8, 1, (x) => (x === 0 ? [0, 0, 0, 255] : x === 1 ? [0, 0, 0, 0] : [255, 255, 255, 255]));
    expect(Array.from(toMono(img, 8, 1, { threshold: 128, dither: false }).bits)).toEqual([0x80]);
  });

  it('dithering turns mid-grey into a pattern of about half the dots', () => {
    const grey = rgba(16, 16, () => [128, 128, 128, 255]);
    const black = Array.from(toMono(grey, 16, 16, { threshold: 128, dither: true }).bits).reduce((s, b) => s + b.toString(2).split('1').length - 1, 0);
    expect(black).toBeGreaterThan(100);
    expect(black).toBeLessThan(156);
  });

  it('trims blank rows but keeps at least 8', () => {
    const bits = new Uint8Array(20);
    bits[10] = 0xff;
    expect(trimRows({ width: 8, height: 20, bits })).toMatchObject({ height: 8 });
    expect(trimRows({ width: 8, height: 20, bits }).bits[0]).toBe(0xff);
  });
});

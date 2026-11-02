// Turns a picture into what a thermal printer prints: 1-bit dots (from TiffinPOS). Pure; the canvas work is in the UI.
import { LOGO_MAX_HEIGHT } from '@dinepos/shared';

export interface MonoLogo {
  width: number;
  height: number;
  bits: Uint8Array;
}

/** Size to draw a picture at: at most `maxWidth` wide (a multiple of 8) and LOGO_MAX_HEIGHT high, keeping its shape. */
export function fitLogo(srcW: number, srcH: number, maxWidth: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / srcW, LOGO_MAX_HEIGHT / srcH, 1);
  const width = Math.max(8, Math.floor((srcW * scale) / 8) * 8);
  const height = Math.max(8, Math.min(LOGO_MAX_HEIGHT, Math.round((srcH * width) / srcW)));
  return { width, height };
}

/**
 * RGBA pixels (as from a canvas) to 1-bit rows, MSB first, 1 = black. Transparent counts as white.
 * threshold 0..255: darker than this prints black. dither: Floyd–Steinberg, for photos rather than line logos.
 */
export function toMono(rgba: Uint8ClampedArray, width: number, height: number, o: { threshold: number; dither: boolean }): MonoLogo {
  if (width % 8 !== 0) throw new RangeError('width must be a multiple of 8');
  const grey = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3]! / 255;
    const lum = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
    grey[i] = lum * a + 255 * (1 - a);
  }
  const bits = new Uint8Array((width / 8) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const black = grey[i]! < o.threshold;
      if (black) bits[y * (width / 8) + (x >> 3)]! |= 0x80 >> (x & 7);
      if (o.dither) {
        const err = grey[i]! - (black ? 0 : 255);
        if (x + 1 < width) grey[i + 1]! += (err * 7) / 16;
        if (y + 1 < height) {
          if (x > 0) grey[i + width - 1]! += (err * 3) / 16;
          grey[i + width]! += (err * 5) / 16;
          if (x + 1 < width) grey[i + width + 1]! += err / 16;
        }
      }
    }
  }
  return { width, height, bits };
}

/** Cuts blank rows off the top and bottom (pictures often have a margin), keeping at least 8 rows. */
export function trimRows(l: MonoLogo): MonoLogo {
  const row = l.width / 8;
  const blank = (y: number) => l.bits.subarray(y * row, (y + 1) * row).every((b) => b === 0);
  let top = 0;
  let bottom = l.height - 1;
  while (top < bottom && blank(top)) top++;
  while (bottom > top && blank(bottom)) bottom--;
  const height = Math.max(8, bottom - top + 1);
  const bits = new Uint8Array(row * height);
  bits.set(l.bits.subarray(top * row, Math.min(l.height, top + height) * row));
  return { width: l.width, height, bits };
}

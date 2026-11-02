// How the customer bill looks (Settings › Bill design, from TiffinPOS). Defaults reproduce the standard bill.
// What the law needs on a tax invoice (name, GSTIN, FSSAI, "TAX INVOICE", bill number, date, tax lines, total)
// always prints and is not an option here.
import { z } from 'zod';

const headerLine = z.string().trim().min(1).max(48);

export const billDisplaySchema = z
  .object({
    /** Restaurant name in double height (large) or normal size. */
    nameSize: z.enum(['large', 'normal']).default('large'),
    /** Extra lines under the name, e.g. "A unit of Spice Hospitality Pvt Ltd". */
    headerLines: z.array(headerLine).max(2).default([]),
    showPhone: z.boolean().default(true),
    showTable: z.boolean().default(true),
    showCovers: z.boolean().default(true),
    showCaptain: z.boolean().default(true),
    showCashier: z.boolean().default(true),
    /** Guest name and phone. A guest GSTIN always prints (B2B invoice). */
    showGuest: z.boolean().default(true),
    /** The Rate column on 80 mm paper and "qty x rate" on 58 mm. */
    showRate: z.boolean().default(true),
    /** Add-ons without a price (spice level, no onion). */
    showFreeChoices: z.boolean().default(true),
    /** "on <taxable amount>" after each GST line (80 mm). */
    showTaxableAmount: z.boolean().default(true),
    /** "Items 5 · Qty 9" above the subtotal. */
    showItemCount: z.boolean().default(false),
  })
  .strict();

export type BillDisplay = z.infer<typeof billDisplaySchema>;

export const DEFAULT_BILL_DISPLAY: BillDisplay = billDisplaySchema.parse({});

/** Thermal printers print 8 dots per mm; 58 mm paper has 384 printable dots, the widest logo that fits both papers. */
export const LOGO_MAX_WIDTH = 384;
export const LOGO_MAX_HEIGHT = 240;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 decode in plain TypeScript (shared code has neither Buffer nor atob). Throws on bad input. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) throw new RangeError('not base64');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (const ch of clean) {
    acc = ((acc << 6) | B64.indexOf(ch)) & 0xffffff; // only the low bits are ever read
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=');
  }
  return s;
}

/** A 1-bit bill logo: rows of width/8 bytes, most significant bit first, 1 = black dot. */
export const billLogoSchema = z
  .object({
    width: z.number().int().min(8).max(LOGO_MAX_WIDTH).multipleOf(8),
    height: z.number().int().min(8).max(LOGO_MAX_HEIGHT),
    bits: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/, 'not base64').max(20_000),
  })
  .strict()
  .superRefine((l, ctx) => {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(l.bits);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'the logo data is not readable', path: ['bits'] });
      return;
    }
    if (bytes.length !== (l.width / 8) * l.height) ctx.addIssue({ code: 'custom', message: 'the logo data does not match its size', path: ['bits'] });
    else if (bytes.every((b) => b === 0)) ctx.addIssue({ code: 'custom', message: 'the logo is blank; choose a darker picture or more darkness', path: ['bits'] });
  });

export type BillLogo = z.infer<typeof billLogoSchema>;

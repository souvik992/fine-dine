// Minimal ESC/POS builder that also records a plain-text preview of every printed line.
// Adapted from Tiffin POS printing/escpos. Non-ASCII text prints as "?" until bitmap text lands (P1-07);
// the rupee sign becomes "Rs".

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export type PaperWidth = 58 | 80;

/** Characters per line in font A. */
export const COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 };

/** Printable ASCII only: typographic quotes/dashes are simplified, ₹ → "Rs", anything else → "?". */
export function sanitize(s: string): string {
  return s
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, 'Rs')
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Word-wraps to `width` columns; words longer than a line are split. Always returns at least one line. */
export function wrapText(s: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (let word of sanitize(s).split(' ').filter(Boolean)) {
    while (word.length > width) {
      if (cur) out.push(cur);
      cur = '';
      out.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export class EscPos {
  private readonly buf: number[] = [];
  private readonly previewLines: string[] = [];
  private widthMul = 1;
  readonly cols: number;

  constructor(paper: PaperWidth) {
    this.cols = COLUMNS[paper];
  }

  raw(...bytes: number[]): this {
    for (const b of bytes) this.buf.push(b & 0xff);
    return this;
  }

  init(): this {
    return this.raw(ESC, 0x40);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Character size multipliers 1..2 (GS !). Double width halves the columns. */
  size(width: 1 | 2, height: 1 | 2): this {
    this.widthMul = width;
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  /** Columns available at the current size. */
  width(): number {
    return Math.floor(this.cols / this.widthMul);
  }

  line(s = ''): this {
    const text = sanitize(s).slice(0, this.width());
    for (const ch of text) this.buf.push(ch.charCodeAt(0));
    this.previewLines.push(text);
    return this.raw(LF);
  }

  /**
   * Left text and right text on one line. When they do not fit, the left side is wrapped on its own line(s)
   * and the right side is right-aligned below: nothing is ever cut (bill numbers, GSTINs, amounts).
   */
  twoCol(left: string, right: string): this {
    const w = this.width();
    const l = sanitize(left);
    const r = sanitize(right);
    if (!r) {
      // Nothing on the right: no trailing padding, but keep the left side's indent.
      const indent = l.length - l.trimStart().length;
      return this.wrapped(l.trimStart(), indent);
    }
    if (l.length + r.length + 1 <= w) return this.line(l + ' '.repeat(w - l.length - r.length) + r);
    if (l) this.wrapped(l);
    for (const part of wrapText(r, w)) this.line(' '.repeat(w - part.length) + part);
    return this;
  }

  /** Word-wrapped text; continuation lines get the same indent. */
  wrapped(s: string, indent = 0, firstPrefix = ''): this {
    const pad = ' '.repeat(indent);
    wrapText(s, this.width() - indent).forEach((part, i) => this.line((i === 0 && firstPrefix ? firstPrefix.padEnd(indent) : pad) + part));
    return this;
  }

  center(s: string): this {
    const w = this.width();
    for (const part of wrapText(s, w)) this.line(' '.repeat(Math.floor((w - part.length) / 2)) + part);
    return this;
  }

  rule(ch = '-'): this {
    return this.line(ch.repeat(this.width()));
  }

  feed(lines: number): this {
    return this.raw(ESC, 0x64, lines);
  }

  /** Partial cut with a short feed (GS V 66 n). */
  cut(): this {
    return this.raw(GS, 0x56, 66, 3);
  }

  drawerKick(): this {
    return this.raw(ESC, 0x70, 0, 25, 250);
  }

  /** Centre alignment on (ESC a 1) or back to left (ESC a 0). Only affects bytes, not the preview. */
  align(center: boolean): this {
    return this.raw(ESC, 0x61, center ? 1 : 0);
  }

  /** Native QR code (model 2, GS ( k), centred. The preview shows `[label]`. */
  qr(data: string, label = 'QR code', size = 6): this {
    const d = sanitize(data);
    if (d.length === 0 || d.length > 400) throw new RangeError('QR data must be 1 to 400 characters');
    this.align(true);
    this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0); // model 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, size); // module size
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 49); // error correction M
    const len = d.length + 3;
    this.raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30);
    for (const ch of d) this.buf.push(ch.charCodeAt(0));
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
    this.raw(LF).align(false);
    const w = this.width();
    const tag = `[${label}]`;
    this.previewLines.push(' '.repeat(Math.max(0, Math.floor((w - tag.length) / 2))) + tag);
    return this;
  }

  /**
   * A 1-bit picture (rows of width/8 bytes, MSB first, 1 = black), centred on the paper with GS v 0 (from TiffinPOS).
   * Font A is 12 dots wide, so the paper is cols × 12 dots (576 on 80 mm, 384 on 58 mm). The preview shows `[logo]`.
   */
  logo(width: number, height: number, data: Uint8Array): this {
    const rowBytes = width / 8;
    if (!Number.isInteger(rowBytes) || data.length !== rowBytes * height) throw new RangeError('logo data does not match its size');
    const paperBytes = (this.cols * 12) / 8;
    if (rowBytes > paperBytes) throw new RangeError('logo wider than the paper');
    const pad = Math.floor((paperBytes - rowBytes) / 2);
    const outRow = rowBytes + pad;
    const out = new Uint8Array(outRow * height);
    for (let y = 0; y < height; y++) out.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), y * outRow + pad);
    this.raw(GS, 0x76, 0x30, 0, outRow & 0xff, outRow >> 8, height & 0xff, height >> 8);
    for (const b of out) this.buf.push(b);
    const w = this.width();
    this.previewLines.push(' '.repeat(Math.floor((w - 6) / 2)) + '[logo]');
    return this;
  }

  /** Prepends a ready-made job (used when rerouting to a backup printer). */
  static prefix(header: Uint8Array, job: Uint8Array): Uint8Array {
    const out = new Uint8Array(header.length + job.length);
    out.set(header, 0);
    out.set(job, header.length);
    return out;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.buf);
  }

  /** The printed lines as plain text (what tests and the fake printer show). */
  preview(): string {
    return `${this.previewLines.join('\n')}\n`;
  }
}

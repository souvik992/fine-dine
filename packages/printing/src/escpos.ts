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

  /** Left text and right text on one line; the left side is cut to fit. */
  twoCol(left: string, right: string): this {
    const w = this.width();
    const r = sanitize(right).slice(0, w);
    const l = sanitize(left).slice(0, Math.max(0, w - r.length - 1));
    return this.line(l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r);
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

  bytes(): Uint8Array {
    return Uint8Array.from(this.buf);
  }

  /** The printed lines as plain text (what tests and the fake printer show). */
  preview(): string {
    return `${this.previewLines.join('\n')}\n`;
  }
}

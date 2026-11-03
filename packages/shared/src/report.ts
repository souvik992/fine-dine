// Reports (P4-03, design from TiffinPOS): every report is a table worked out on the server in integer paise. The
// screen and the CSV show exactly the same figures; clients never add money up.

export type ColType = 'text' | 'money' | 'int';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColType;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportInfo {
  key: string;
  title: string;
  group: string;
  description: string;
}

export interface ReportTable extends ReportInfo {
  /** Business dates, inclusive. */
  from: string;
  to: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  /** Headline figures shown above the table. */
  summary: Array<{ label: string; value: number | string; type: ColType }>;
}

const rupees = (p: number) => {
  const a = Math.abs(p);
  return `${p < 0 ? '-' : ''}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

/** Text for a spreadsheet: a leading = + - @ is neutralised (formula injection), quotes doubled. */
const textCell = (s: string) => {
  const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

function cell(v: string | number | null | undefined, type: ColType): string {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money') return rupees(Number(v)); // a plain number, so Excel can add it up
  if (type === 'int') return String(v);
  return textCell(String(v));
}

/** The report as CSV for Excel: UTF-8 with a BOM, amounts in rupees as plain numbers, a TOTAL row. */
export function reportToCsv(t: ReportTable): { filename: string; csv: string } {
  const lines = [t.columns.map((c) => textCell(c.label)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => cell(r[c.key], c.type)).join(','));
  if (t.totals) lines.push(t.columns.map((c, i) => (i === 0 ? 'TOTAL' : cell(t.totals![c.key], c.type))).join(','));
  return { filename: `${t.key}_${t.from}_to_${t.to}.csv`, csv: `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n` };
}

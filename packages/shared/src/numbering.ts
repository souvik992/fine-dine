// Invoice numbering (docs/08-billing-gst.md "Numbering"). Decided 2026-11-02: the invoice date and financial
// year come from the calendar date of printing in the outlet time zone, not the business date.
import { localDate } from './time.js';

/** GST invoice numbers may have at most 16 characters (confirm with the outlet's CA). */
export const MAX_BILL_NO_LENGTH = 16;
export const DEFAULT_BILL_PREFIX = 'B';
export const BILL_PREFIX_RE = /^[A-Z0-9]{1,3}$/;

/** Indian financial year (1 April – 31 March) of a `YYYY-MM-DD` date, e.g. "2027-03-31" → "26-27". */
export function financialYearOf(date: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: "${date}"`);
  const year = Number(m[1]);
  const start = Number(m[2]) >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return `${yy(start)}-${yy(start + 1)}`;
}

/** Financial year of an instant in the outlet's time zone. */
export function financialYearAt(at: Date, timeZone: string): string {
  return financialYearOf(localDate(at, timeZone));
}

/** "B/26-27/000123". Throws if the prefix or number would break the 16-character limit. */
export function formatBillNo(prefix: string, fy: string, seq: number): string {
  if (!BILL_PREFIX_RE.test(prefix)) throw new RangeError(`bill prefix must be 1 to 3 capital letters or digits, got "${prefix}"`);
  if (!/^\d{2}-\d{2}$/.test(fy)) throw new RangeError(`not a financial year: "${fy}"`);
  if (!Number.isSafeInteger(seq) || seq < 1 || seq > 999_999) throw new RangeError('bill number out of range (1..999999)');
  const no = `${prefix}/${fy}/${String(seq).padStart(6, '0')}`;
  if (no.length > MAX_BILL_NO_LENGTH) throw new RangeError(`bill number "${no}" exceeds ${MAX_BILL_NO_LENGTH} characters`);
  return no;
}

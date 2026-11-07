// Search in the Bills dialog (pure, tested).
import { formatINR, type DayBill } from '@dinepos/shared';

export const BILL_STATE: Record<DayBill['state'], string> = { printed: 'Unpaid', superseded: 'Replaced', settled: 'Paid', void: 'VOID' };

/** Search over a bill: number, table, payment mode, status, or amount (e.g. "1250" or "1,250.00"). */
export function billMatches(b: DayBill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/[^0-9]/g, '');
  const rupees = String(Math.floor(b.totalPaise / 100));
  const text = [b.billNo, b.table, BILL_STATE[b.state], ...b.payments.map((p) => p.mode), formatINR(b.totalPaise)].join(' ').toLowerCase();
  return text.includes(q) || (digits !== '' && /^[0-9.,₹\s]+$/.test(q) && (rupees.includes(digits) || String(b.totalPaise).includes(digits)));
}

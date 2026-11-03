// Audit viewer and leakage dashboard (P4-01, docs/09 §5, docs/02 "Leakage flags"). Reads the append-only audit log;
// amounts are integer paise taken from what each command recorded. Dates are the outlet's calendar days.
import { isoInZone } from '@dinepos/shared';
import { PosError } from '../core/errors.js';
import type { Db } from '../db/connection.js';

/** UTC instants of local midnight at the start of `from` and the end of `to` in the outlet zone. */
export function dayBounds(from: string, to: string, timeZone: string): { start: string; end: string } {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new PosError('VALIDATION', 'Dates must be YYYY-MM-DD.');
  if (from > to) throw new PosError('VALIDATION', 'The start date must be on or before the end date.');
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new PosError('VALIDATION', 'Choose at most one year at a time.');
  const midnight = (day: string) => {
    const guess = Date.parse(`${day}T00:00:00Z`);
    const off = /([+-])(\d{2}):(\d{2})$/.exec(isoInZone(new Date(guess), timeZone));
    const minutes = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0;
    return new Date(guess - minutes * 60_000).toISOString();
  };
  return { start: midnight(from), end: midnight(new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) };
}

/** Plain words for the actions people look for (anything else shows its code). */
export const ACTION_LABEL: Record<string, string> = {
  'item.cancel_fired': 'Cancelled after KOT',
  'item.modify_fired': 'Reduced after KOT',
  'kot.reprint': 'KOT reprinted',
  'bill.reprint': 'Bill reprinted',
  'order.move_table': 'Table moved',
  'order.merge_in': 'Tables merged',
  'order.merged': 'Merged into another table',
  'order.transfer_items': 'Items moved to another table',
  'bill.void': 'Bill voided',
  'bill.print': 'Bill printed',
  'bill.reissue': 'Bill printed again',
  'bill.settle': 'Bill settled',
  'bill.split': 'Bill split',
  'cash.pay_out': 'Cash paid out',
  'cash.pay_in': 'Cash paid in',
  'drawer.open': 'Drawer opened (no sale)',
  'day.close': 'Day closed',
  'order.open': 'Table seated',
  'order.items.add': 'Items added',
  'order.item.update': 'Unsent item changed',
  'order.item.remove': 'Unsent item removed',
  'kot.fire': 'KOT sent',
  'order.reopen': 'Bill reopened (items added)',
  'auth.login': 'Signed in',
  'auth.fail': 'Wrong PIN',
  'auth.lock': 'Locked after wrong PINs',
  'device.pair': 'Device paired',
  'device.revoke': 'Device revoked',
  'config.set': 'Setting changed',
  'backup.restore_staged': 'Backup restore started',
};

interface AuditRow {
  seq: number;
  ts: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  leakage_flag: number;
  user_name: string | null;
  approver_name: string | null;
  device_name: string | null;
}

const json = (s: string | null): Record<string, unknown> => {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** What the row is about, in words (bill number, item, KOT, table…), and the money involved when there is some. */
function describe(db: Db, r: AuditRow): { ref: string; amountPaise: number | null } {
  const before = json(r.before_json);
  const after = json(r.after_json);
  const item = () => db.prepare('SELECT name_snapshot, unit_price_paise FROM order_item WHERE id = ?').get(r.entity_id) as { name_snapshot: string; unit_price_paise: number } | undefined;
  const billNo = () => (db.prepare('SELECT bill_no_text FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').pluck().get(r.entity_id) as string | undefined) ?? '';
  switch (r.action) {
    case 'item.cancel_fired': {
      const i = item();
      return { ref: `${num(before.qty)} × ${i?.name_snapshot ?? '?'}`, amountPaise: num(before.qty) * (i?.unit_price_paise ?? 0) };
    }
    case 'item.modify_fired': {
      const i = item();
      const gone = num(before.qty) - num(after.qty);
      return { ref: `${i?.name_snapshot ?? '?'}: ${num(before.qty)} → ${num(after.qty)}`, amountPaise: gone * (i?.unit_price_paise ?? 0) };
    }
    case 'bill.void':
      return { ref: (after.billNo as string | undefined) ?? billNo(), amountPaise: num(before.totalPaise) };
    case 'bill.print':
    case 'bill.reissue':
      return { ref: str(after.billNo, ''), amountPaise: r.leakage_flag ? num(after.discount) : num(after.total) };
    case 'bill.reprint':
      return { ref: str(after.billNo, ''), amountPaise: null };
    case 'bill.settle':
      return { ref: billNo(), amountPaise: num(after.totalPaise) };
    case 'kot.reprint':
    case 'kot.fire': {
      const k = db.prepare('SELECT kot_no FROM kot WHERE id = ?').pluck().get(r.entity_id) as number | undefined;
      return { ref: k ? `KOT ${String(k).padStart(4, '0')}` : '', amountPaise: null };
    }
    case 'order.move_table':
      return { ref: `${str(before.table, '?')} → ${str(after.table, '?')}`, amountPaise: null };
    case 'order.merge_in':
      return { ref: `${str(before.sourceTable, '?')} → ${str(before.targetTable, '?')}`, amountPaise: null };
    case 'order.transfer_items':
      return { ref: `${str(before.table, '?')} → ${str(after.table, '?')} (${Array.isArray(after.items) ? after.items.length : 0} lines)`, amountPaise: null };
    case 'cash.pay_out':
    case 'cash.pay_in':
      return { ref: '', amountPaise: num(after.amountPaise) };
    case 'day.close':
      return { ref: r.entity_id ?? '', amountPaise: num(after.cashCountedPaise) - num(after.cashExpectedPaise) };
    default:
      return { ref: '', amountPaise: null };
  }
}

export interface AuditEntry {
  seq: number;
  at: string;
  action: string;
  label: string;
  ref: string;
  amountPaise: number | null;
  reason: string | null;
  leakage: boolean;
  by: string | null;
  approvedBy: string | null;
  device: string | null;
}

const SELECT = `SELECT a.seq, a.ts, a.action, a.entity, a.entity_id, a.before_json, a.after_json, a.reason, a.leakage_flag,
    u.name AS user_name, ap.name AS approver_name, d.name AS device_name
  FROM audit_event a LEFT JOIN app_user u ON u.id = a.user_id LEFT JOIN app_user ap ON ap.id = a.approved_by LEFT JOIN device d ON d.id = a.device_id`;

function entry(db: Db, r: AuditRow, timeZone: string): AuditEntry {
  const local = isoInZone(new Date(r.ts), timeZone);
  return {
    seq: r.seq,
    at: `${local.slice(8, 10)}-${local.slice(5, 7)}-${local.slice(2, 4)} ${local.slice(11, 16)}`,
    action: r.action,
    label: ACTION_LABEL[r.action] ?? r.action,
    ...describe(db, r),
    reason: r.reason,
    leakage: r.leakage_flag === 1,
    by: r.user_name,
    approvedBy: r.approver_name,
    device: r.device_name,
  };
}

/** One page of the audit log, newest first. `before` is the seq to continue from. */
export function auditPage(
  db: Db,
  q: { from: string; to: string; leakageOnly?: boolean; actions?: string[]; limit?: number; before?: number },
  timeZone: string,
): { entries: AuditEntry[]; next: number | null } {
  const { start, end } = dayBounds(q.from, q.to, timeZone);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const rows = db
    .prepare(
      `${SELECT} WHERE a.ts >= @start AND a.ts < @end ${q.leakageOnly ? 'AND a.leakage_flag = 1' : ''}
       ${q.actions?.length ? 'AND a.action IN (SELECT value FROM json_each(@actions))' : ''} ${q.before ? 'AND a.seq < @before' : ''}
       ORDER BY a.seq DESC LIMIT @limit`,
    )
    .all({ start, end, actions: JSON.stringify(q.actions ?? []), before: q.before ?? 0, limit: limit + 1 }) as AuditRow[];
  const page = rows.slice(0, limit);
  return { entries: page.map((r) => entry(db, r, timeZone)), next: rows.length > limit ? page.at(-1)!.seq : null };
}

/** The dashboard cards (docs/09 §5): what to look at, how often and how much. `actions` drive the drill-down. */
export const LEAKAGE_CARDS = [
  { key: 'cancelled', label: 'Cancelled after KOT', actions: ['item.cancel_fired'], hint: 'Food the kitchen got and was then taken off the bill.' },
  { key: 'reduced', label: 'Reduced after KOT', actions: ['item.modify_fired'], hint: 'Quantities lowered after the kitchen got them.' },
  { key: 'voids', label: 'Void bills', actions: ['bill.void'], hint: 'Bills cancelled after printing or payment.' },
  { key: 'discounts', label: 'Discounts above limit', actions: ['bill.print', 'bill.reissue'], hint: 'Discounts bigger than the role allows (a manager PIN was used).' },
  { key: 'reprints', label: 'Reprints', actions: ['kot.reprint', 'bill.reprint'], hint: 'KOTs and bills printed again (DUPLICATE).' },
  { key: 'moves', label: 'Moves and transfers', actions: ['order.move_table', 'order.merge_in', 'order.transfer_items'], hint: 'Tables moved or merged, items moved, after the kitchen got them.' },
  { key: 'complimentary', label: 'Complimentary', actions: ['bill.settle'], hint: 'Bills settled as complimentary.' },
  { key: 'cash', label: 'Cash out and drawer', actions: ['cash.pay_out', 'drawer.open'], hint: 'Cash taken out and the drawer opened without a sale.' },
  { key: 'cash-difference', label: 'Day-end cash difference', actions: ['day.close'], hint: 'Counted cash that did not match.' },
] as const;

export interface LeakageCard {
  key: string;
  label: string;
  hint: string;
  count: number;
  amountPaise: number;
  actions: readonly string[];
}

export function leakageSummary(db: Db, from: string, to: string, timeZone: string): { cards: LeakageCard[]; unbilled: { orders: number; items: number; amountPaise: number } } {
  const { start, end } = dayBounds(from, to, timeZone);
  const rows = db.prepare(`${SELECT} WHERE a.ts >= @start AND a.ts < @end AND a.leakage_flag = 1`).all({ start, end }) as AuditRow[];
  const cards = LEAKAGE_CARDS.map((c) => {
    const mine = rows.filter((r) => (c.actions as readonly string[]).includes(r.action));
    return { ...c, count: mine.length, amountPaise: mine.reduce((s, r) => s + Math.abs(describe(db, r).amountPaise ?? 0), 0) };
  });
  // Food sent to the kitchen on orders that ended without a paid bill (void orders), by business date.
  const unbilled = db
    .prepare(
      `SELECT count(DISTINCT o.id) AS orders, coalesce(sum(oi.qty), 0) AS items, coalesce(sum(oi.qty * oi.unit_price_paise), 0) AS amountPaise
       FROM "order" o JOIN order_item oi ON oi.order_id = o.id
       WHERE o.business_date BETWEEN ? AND ? AND o.state = 'void' AND oi.status = 'fired'`,
    )
    .get(from, to) as { orders: number; items: number; amountPaise: number };
  return { cards, unbilled };
}

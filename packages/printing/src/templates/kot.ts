// Kitchen order ticket (docs/06-printing-kds.md "KOT"). No prices on a KOT.
import { EscPos, type PaperWidth } from '../escpos.js';

export type KotKind = 'new' | 'modify' | 'cancel' | 'move_notice';

export interface KotTicketLine {
  /** On a change slip, the quantity removed as a negative number (prints "-1"). */
  qty: number;
  /** Change slip: the quantity left after a reduction ("now 2"). */
  nowQty?: number | null;
  name: string;
  course: number;
  addons: Array<{ name: string; qty: number }>;
  note?: string | null;
}

export interface KotTicket {
  kotNo: number;
  kind: KotKind;
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  stationName: string;
  tableLabel?: string | null;
  /** P4-06: an online order's number and how it goes out, e.g. "W-1042 · DELIVERY · PAID ONLINE". */
  orderRef?: string | null;
  /** The customer's note for the whole order (online orders), e.g. "Allergic to peanuts"; prints after the dishes. */
  orderNote?: string | null;
  areaName?: string | null;
  covers?: number | null;
  captainName?: string | null;
  /** Local time and date as printed, e.g. "20:14" and "02-11-26". */
  time: string;
  date: string;
  lines: KotTicketLine[];
  duplicate?: boolean;
  /** Change slips: the KOT being changed, and why. */
  forKotNo?: number | null;
  reason?: string | null;
  /** Move notices: what moved where, e.g. "MOVED T4 -> T9" (P2-03). */
  notice?: string | null;
}

export interface RenderOptions {
  paper: PaperWidth;
  /** Blank lines before the cut. */
  feed?: number;
}

const ORDER_TYPE: Record<KotTicket['orderType'], string> = {
  dine_in: 'DINE-IN',
  takeaway: 'TAKEAWAY',
  delivery: 'DELIVERY',
  online: 'ONLINE',
};

const TITLE: Record<KotKind, string> = { new: 'KOT', modify: 'MODIFIED KOT', cancel: 'CANCELLED KOT', move_notice: 'MOVED KOT' };

export function renderKot(t: KotTicket, opts: RenderOptions): { bytes: Uint8Array; preview: string } {
  const p = new EscPos(opts.paper).init();
  const no = String(t.kotNo).padStart(4, '0');

  if (t.duplicate) p.center('** DUPLICATE **');
  // Double width leaves 16 columns on 58 mm: a long title wraps ("CANCELLED KOT" / "0043") instead of being cut.
  p.bold(true).size(2, 2).wrapped(`${TITLE[t.kind]} ${no}`).size(1, 1).bold(false);
  p.twoCol(`Station: ${t.stationName}`, ORDER_TYPE[t.orderType]);
  if (t.tableLabel) {
    p.twoCol(`Table ${t.tableLabel}${t.areaName ? ` (${t.areaName})` : ''}`, t.covers ? `Covers ${t.covers}` : '');
  }
  if (t.orderRef) p.bold(true).wrapped(t.orderRef).bold(false);
  p.twoCol(t.captainName ? `Captain: ${t.captainName}` : '', `${t.time}  ${t.date}`);
  if (t.forKotNo) p.bold(true).line(`Changes KOT ${String(t.forKotNo).padStart(4, '0')}`).bold(false);
  if (t.notice) p.bold(true).size(1, 2).wrapped(t.notice).size(1, 1).bold(false);
  p.rule();

  const courses = [...new Set(t.lines.map((l) => l.course))].sort((a, b) => a - b);
  const showCourse = courses.length > 1 || (courses[0] ?? 1) > 1;
  for (const course of courses) {
    if (showCourse) p.bold(true).line(`Course ${course}`).bold(false);
    for (const l of t.lines.filter((x) => x.course === course)) {
      p.bold(true).wrapped(l.name, 3, String(l.qty)).bold(false);
      if (l.nowQty) p.wrapped(`now ${l.nowQty}`, 5);
      for (const a of l.addons) p.wrapped(`+ ${a.qty > 1 ? `${a.qty} x ` : ''}${a.name}`, 5);
      if (l.note) p.wrapped(`! ${l.note}`, 5);
    }
  }
  if (t.orderNote) p.bold(true).wrapped(`NOTE: ${t.orderNote}`).bold(false);
  p.rule();
  if (t.reason) p.wrapped(`Reason: ${t.reason}`);
  p.feed(opts.feed ?? 3).cut();
  return { bytes: p.bytes(), preview: p.preview() };
}

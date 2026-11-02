// Kitchen order ticket (docs/06-printing-kds.md "KOT"). No prices on a KOT.
import { EscPos, type PaperWidth } from '../escpos.js';

export type KotKind = 'new' | 'modify' | 'cancel' | 'move_notice';

export interface KotTicketLine {
  qty: number;
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
  areaName?: string | null;
  covers?: number | null;
  captainName?: string | null;
  /** Local time and date as printed, e.g. "20:14" and "02-11-26". */
  time: string;
  date: string;
  lines: KotTicketLine[];
  duplicate?: boolean;
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
  p.bold(true).size(2, 2).line(`${TITLE[t.kind]} ${no}`).size(1, 1).bold(false);
  p.twoCol(`Station: ${t.stationName}`, ORDER_TYPE[t.orderType]);
  if (t.tableLabel) {
    p.twoCol(`Table ${t.tableLabel}${t.areaName ? ` (${t.areaName})` : ''}`, t.covers ? `Covers ${t.covers}` : '');
  }
  p.twoCol(t.captainName ? `Captain: ${t.captainName}` : '', `${t.time}  ${t.date}`);
  p.rule();

  const courses = [...new Set(t.lines.map((l) => l.course))].sort((a, b) => a - b);
  const showCourse = courses.length > 1 || (courses[0] ?? 1) > 1;
  for (const course of courses) {
    if (showCourse) p.bold(true).line(`Course ${course}`).bold(false);
    for (const l of t.lines.filter((x) => x.course === course)) {
      p.bold(true).wrapped(l.name, 3, String(l.qty)).bold(false);
      for (const a of l.addons) p.wrapped(`+ ${a.qty > 1 ? `${a.qty} x ` : ''}${a.name}`, 5);
      if (l.note) p.wrapped(`! ${l.note}`, 5);
    }
  }
  p.rule();
  p.feed(opts.feed ?? 3).cut();
  return { bytes: p.bytes(), preview: p.preview() };
}

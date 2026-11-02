// Customer bill (docs/06-printing-kds.md "Bill"). The template only arranges figures the server computed with
// calculateBill; it never adds, rounds or taxes anything itself.
import { DEFAULT_BILL_DISPLAY, type BillBreakup, type BillDisplay } from '@dinepos/shared';
import { EscPos, wrapText, type PaperWidth } from '../escpos.js';
import { halfPercent, money, padLeft, percent, plainRupees } from '../layout.js';

export interface BillOutlet {
  name: string;
  addressLines: string[];
  gstin?: string | null;
  fssai?: string | null;
  phone?: string | null;
  footerLines?: string[];
}

export interface BillDocLine {
  name: string;
  qty: number;
  unitPricePaise: number;
  /** unit price × qty (addons are listed under the line with their own amounts). */
  amountPaise: number;
  addons?: Array<{ name: string; qty: number; amountPaise: number }>;
}

export interface BillDocument {
  outlet: BillOutlet;
  /** Formatted bill number, e.g. "T1/26-27/000123". */
  billNo: string;
  date: string;
  time: string;
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'online';
  tableLabel?: string | null;
  areaName?: string | null;
  covers?: number | null;
  captainName?: string | null;
  cashierName?: string | null;
  customer?: { name?: string | null; phone?: string | null; gstin?: string | null } | null;
  lines: BillDocLine[];
  breakup: BillBreakup;
  discountReason?: string | null;
  serviceChargeBp?: number | null;
  interState?: boolean;
  upi?: { vpa: string; payeeName: string } | null;
  part?: { no: number; of: number } | null;
  duplicate?: boolean;
  /** What to show (Settings › Bill design). Stored with the bill so a reprint looks the same; missing = standard. */
  display?: BillDisplay | null;
  /** Settings › Bill design "Print a sample": marked so it cannot pass as a bill. */
  sample?: boolean;
}

export interface BillLogoBits {
  width: number;
  height: number;
  data: Uint8Array;
}

export function upiUri(vpa: string, payeeName: string, amountPaise: number, note: string): string {
  const q = (s: string) => encodeURIComponent(s);
  return `upi://pay?pa=${q(vpa)}&pn=${q(payeeName)}&am=${plainRupees(amountPaise)}&cu=INR&tn=${q(note)}`;
}

const SAMPLE = '*** SAMPLE - NOT A BILL ***';

export function renderBill(doc: BillDocument, opts: { paper: PaperWidth; feed?: number; logo?: BillLogoBits | null }): { bytes: Uint8Array; preview: string } {
  const p = new EscPos(opts.paper).init();
  const wide = opts.paper === 80;
  const b = doc.breakup;
  const d = { ...DEFAULT_BILL_DISPLAY, ...doc.display };

  // Header
  if (doc.sample) p.bold(true).center(SAMPLE).bold(false);
  if (doc.duplicate) p.center('** DUPLICATE **');
  if (opts.logo) p.logo(opts.logo.width, opts.logo.height, opts.logo.data);
  if (d.nameSize === 'large') p.bold(true).size(1, 2).center(doc.outlet.name).size(1, 1).bold(false);
  else p.bold(true).center(doc.outlet.name).bold(false);
  for (const h of d.headerLines) p.center(h);
  for (const a of doc.outlet.addressLines) p.center(a);
  if (doc.outlet.phone && d.showPhone) p.center(`Ph: ${doc.outlet.phone}`);
  if (doc.outlet.gstin) p.center(`GSTIN: ${doc.outlet.gstin}`);
  if (doc.outlet.fssai) p.center(`FSSAI: ${doc.outlet.fssai}`);
  p.bold(true).center('TAX INVOICE').bold(false);
  if (doc.part && doc.part.of > 1) p.center(`Part ${doc.part.no} of ${doc.part.of}`);
  p.rule();

  p.twoCol(`Bill: ${doc.billNo}`, `${doc.date} ${doc.time}`);
  const covers = doc.covers && d.showCovers ? `Covers ${doc.covers}` : '';
  if (doc.tableLabel && d.showTable) p.twoCol(`Table ${doc.tableLabel}${doc.areaName ? ` (${doc.areaName})` : ''}`, covers);
  else if (doc.tableLabel) {
    if (covers) p.line(covers);
  } else p.line(doc.orderType === 'takeaway' ? 'Takeaway' : doc.orderType === 'delivery' ? 'Delivery' : 'Online order');
  const captain = doc.captainName && d.showCaptain ? `Captain: ${doc.captainName}` : '';
  const cashier = doc.cashierName && d.showCashier ? `Cashier: ${doc.cashierName}` : '';
  if (captain || cashier) p.twoCol(captain, cashier);
  if (d.showGuest && (doc.customer?.name || doc.customer?.phone)) p.line(`Guest: ${[doc.customer.name, doc.customer.phone].filter(Boolean).join(', ')}`);
  if (doc.customer?.gstin) p.line(`Guest GSTIN: ${doc.customer.gstin}`);
  p.rule();

  // Lines. Free choices (spice level, no onion) print without an amount, or not at all.
  const addons = (l: BillDocLine) => {
    for (const a of l.addons ?? []) {
      if (a.amountPaise || d.showFreeChoices) p.twoCol(`  + ${a.qty > 1 ? `${a.qty} x ` : ''}${a.name}`, a.amountPaise ? money(a.amountPaise) : '');
    }
  };
  if (wide) {
    const nameW = d.showRate ? 22 : 32;
    p.bold(true).line(`${'Item'.padEnd(nameW)} ${padLeft('Qty', 4)}${d.showRate ? ` ${padLeft('Rate', 9)}` : ''} ${padLeft('Amount', 10)}`).bold(false);
    for (const l of doc.lines) {
      const parts = wrapText(l.name, nameW);
      p.line(`${parts[0]!.padEnd(nameW)} ${padLeft(String(l.qty), 4)}${d.showRate ? ` ${padLeft(money(l.unitPricePaise), 9)}` : ''} ${padLeft(money(l.amountPaise), 10)}`);
      for (const rest of parts.slice(1)) p.line(rest);
      addons(l);
    }
  } else {
    for (const l of doc.lines) {
      p.wrapped(l.name);
      p.twoCol(d.showRate ? `  ${l.qty} x ${money(l.unitPricePaise)}` : `  Qty ${l.qty}`, money(l.amountPaise));
      addons(l);
    }
  }
  p.rule();

  // Totals (all from calculateBill)
  if (d.showItemCount) p.twoCol(`Items ${doc.lines.length}`, `Qty ${doc.lines.reduce((s, l) => s + l.qty, 0)}`);
  p.twoCol('Subtotal', money(b.subtotal));
  if (b.discount > 0) p.twoCol(`Discount${doc.discountReason ? ` (${doc.discountReason})` : ''}`, `-${money(b.discount)}`);
  if (b.serviceCharge > 0) {
    p.twoCol(`Service charge${doc.serviceChargeBp ? ` @${percent(doc.serviceChargeBp)}%` : ''}`, money(b.serviceCharge));
  }
  for (const g of b.taxGroups) {
    if (g.tax === 0) continue;
    const on = wide && d.showTaxableAmount ? ` on ${money(g.taxable)}` : '';
    if (doc.interState) p.twoCol(`IGST @${percent(g.rateBp)}%${on}`, money(g.igst));
    else {
      p.twoCol(`CGST @${halfPercent(g.rateBp)}%${on}`, money(g.cgst));
      p.twoCol(`SGST @${halfPercent(g.rateBp)}%${on}`, money(g.sgst));
    }
  }
  if (b.pricingMode === 'inclusive') p.line('(Prices include GST)');
  if (b.roundOff !== 0) p.twoCol('Round off', `${b.roundOff > 0 ? '+' : '-'}${money(Math.abs(b.roundOff))}`);
  p.rule('=');
  p.bold(true).size(1, 2).twoCol('TOTAL', `Rs ${money(b.total)}`).size(1, 1).bold(false);
  p.rule('=');

  // Payment QR and footer
  if (doc.upi && b.total > 0) {
    p.center('Scan to pay with any UPI app');
    p.qr(upiUri(doc.upi.vpa, doc.upi.payeeName, b.total, `Bill ${doc.billNo}`), 'UPI QR');
  }
  for (const f of doc.outlet.footerLines ?? []) p.center(f);
  if (doc.sample) p.bold(true).center(SAMPLE).bold(false);
  p.feed(opts.feed ?? 3).cut();
  return { bytes: p.bytes(), preview: p.preview() };
}

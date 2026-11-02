// Customer bill (docs/06-printing-kds.md "Bill"). The template only arranges figures the server computed with
// calculateBill; it never adds, rounds or taxes anything itself.
import type { BillBreakup } from '@dinepos/shared';
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
}

export function upiUri(vpa: string, payeeName: string, amountPaise: number, note: string): string {
  const q = (s: string) => encodeURIComponent(s);
  return `upi://pay?pa=${q(vpa)}&pn=${q(payeeName)}&am=${plainRupees(amountPaise)}&cu=INR&tn=${q(note)}`;
}

export function renderBill(doc: BillDocument, opts: { paper: PaperWidth; feed?: number }): { bytes: Uint8Array; preview: string } {
  const p = new EscPos(opts.paper).init();
  const wide = opts.paper === 80;
  const b = doc.breakup;

  // Header
  if (doc.duplicate) p.center('** DUPLICATE **');
  p.bold(true).size(1, 2).center(doc.outlet.name).size(1, 1).bold(false);
  for (const a of doc.outlet.addressLines) p.center(a);
  if (doc.outlet.phone) p.center(`Ph: ${doc.outlet.phone}`);
  if (doc.outlet.gstin) p.center(`GSTIN: ${doc.outlet.gstin}`);
  if (doc.outlet.fssai) p.center(`FSSAI: ${doc.outlet.fssai}`);
  p.bold(true).center('TAX INVOICE').bold(false);
  if (doc.part && doc.part.of > 1) p.center(`Part ${doc.part.no} of ${doc.part.of}`);
  p.rule();

  p.twoCol(`Bill: ${doc.billNo}`, `${doc.date} ${doc.time}`);
  if (doc.tableLabel) p.twoCol(`Table ${doc.tableLabel}${doc.areaName ? ` (${doc.areaName})` : ''}`, doc.covers ? `Covers ${doc.covers}` : '');
  else p.line(doc.orderType === 'takeaway' ? 'Takeaway' : doc.orderType === 'delivery' ? 'Delivery' : 'Online order');
  if (doc.captainName || doc.cashierName) {
    p.twoCol(doc.captainName ? `Captain: ${doc.captainName}` : '', doc.cashierName ? `Cashier: ${doc.cashierName}` : '');
  }
  if (doc.customer?.name || doc.customer?.phone) p.line(`Guest: ${[doc.customer.name, doc.customer.phone].filter(Boolean).join(', ')}`);
  if (doc.customer?.gstin) p.line(`Guest GSTIN: ${doc.customer.gstin}`);
  p.rule();

  // Lines
  if (wide) {
    p.bold(true).line(`${'Item'.padEnd(22)} ${padLeft('Qty', 4)} ${padLeft('Rate', 9)} ${padLeft('Amount', 10)}`).bold(false);
    for (const l of doc.lines) {
      const parts = wrapText(l.name, 22);
      p.line(`${parts[0]!.padEnd(22)} ${padLeft(String(l.qty), 4)} ${padLeft(money(l.unitPricePaise), 9)} ${padLeft(money(l.amountPaise), 10)}`);
      for (const rest of parts.slice(1)) p.line(rest);
      for (const a of l.addons ?? []) p.twoCol(`  + ${a.qty > 1 ? `${a.qty} x ` : ''}${a.name}`, money(a.amountPaise));
    }
  } else {
    for (const l of doc.lines) {
      p.wrapped(l.name);
      p.twoCol(`  ${l.qty} x ${money(l.unitPricePaise)}`, money(l.amountPaise));
      for (const a of l.addons ?? []) p.twoCol(`  + ${a.qty > 1 ? `${a.qty} x ` : ''}${a.name}`, money(a.amountPaise));
    }
  }
  p.rule();

  // Totals (all from calculateBill)
  p.twoCol('Subtotal', money(b.subtotal));
  if (b.discount > 0) p.twoCol(`Discount${doc.discountReason ? ` (${doc.discountReason})` : ''}`, `-${money(b.discount)}`);
  if (b.serviceCharge > 0) {
    p.twoCol(`Service charge${doc.serviceChargeBp ? ` @${percent(doc.serviceChargeBp)}%` : ''}`, money(b.serviceCharge));
  }
  for (const g of b.taxGroups) {
    if (g.tax === 0) continue;
    const on = wide ? ` on ${money(g.taxable)}` : '';
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
  p.feed(opts.feed ?? 3).cut();
  return { bytes: p.bytes(), preview: p.preview() };
}

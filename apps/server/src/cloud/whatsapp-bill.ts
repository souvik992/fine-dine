// Bills on WhatsApp through PosiNext Cloud (posinext-cloud hub/src/whatsapp-bills.ts). Two ways:
//  - The QR on the bill (Settings › Bill design "WhatsApp QR"): PrintBill prints /wa/bill/<code> and sends the bill up
//    inside its bill.printed sync event (payload.share), so the cloud can answer the guest's WhatsApp message with it.
//  - "Send on WhatsApp" in Today's bills: the cashier types the guest's mobile; the server posts the bill to the cloud,
//    which sends it with an approved template (POST /v1/pos/bills/<code>/whatsapp).
// A bill's code is 12 characters made from the bill id and this database's sync stream id, so a reprint (and the
// "Send" button) always gets the same code without storing it. Nothing here runs inside a command's transaction
// except shareCode/whatsappQrUrl/hubBill, which only read.
import { createHmac } from 'node:crypto';
import type { BillDocument } from '@dinepos/printing';
import type { Db } from '../db/connection.js';
import { linkRow } from '../online/online-support.js';
import { syncStream } from '../sync/sync-support.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32: no I, O, 0 or 1

/** The bill's code on PosiNext Cloud (A-Z and 2-9 without I and O, 12 characters). */
export function shareCode(db: Db, billId: string): string {
  const mac = createHmac('sha256', syncStream(db).streamId).update(`whatsapp-bill:${billId}`).digest();
  let code = '';
  for (let i = 0; i < 12; i++) code += CODE_CHARS[mac[i]! % 32];
  return code;
}

/** The cloud this outlet is linked with (Settings › Online orders), or null. */
export function cloudLink(db: Db): { url: string; key: string } | null {
  const l = linkRow(db);
  return l?.hub_url && l.device_key ? { url: l.hub_url.replace(/\/+$/, ''), key: l.device_key } : null;
}

/** What the bill's QR opens, or null when the outlet is not linked with the cloud. */
export function whatsappQrUrl(db: Db, billId: string): string | null {
  const link = cloudLink(db);
  return link ? `${link.url}/wa/bill/${shareCode(db, billId)}` : null;
}

/** The cloud's bill shape (hub/src/bill-doc.ts BillDoc): the printed bill's figures, nothing recalculated. */
export interface HubBill {
  store: { name: string; address?: string; phone?: string; gstin?: string; fssai?: string };
  title: string;
  billNo: string;
  issuedAt: string;
  orderLabel?: string;
  lines: Array<{ name: string; qty: string; amountPaise: number }>;
  summary: Array<{ label: string; amountPaise: number }>;
  totalPaise: number;
  payments: Array<{ mode: string; amountPaise: number }>;
  footer?: string;
}

const pct = (bp: number) => String(bp / 100);
const MODE: Record<string, string> = { cash: 'Cash', card: 'Card', upi: 'UPI', online: 'Online', wallet: 'Wallet', credit: 'Credit' };

/** The printed bill as the cloud keeps it. issuedAt: the bill's print time (ISO); payments: what was received. */
export function hubBill(doc: BillDocument, issuedAt: string, payments: Array<{ mode: string; amountPaise: number }> = []): HubBill {
  const b = doc.breakup;
  // prices that include GST: the tax lines are inside the subtotal, so they say so (the figures stay as printed)
  const incl = b.pricingMode === 'inclusive' ? ' (included)' : '';
  const lines: HubBill['lines'] = [];
  for (const l of doc.lines) {
    lines.push({ name: l.name, qty: l.qtyText ?? String(l.qty), amountPaise: l.amountPaise });
    for (const a of l.addons ?? []) if (a.amountPaise) lines.push({ name: `+ ${a.name}`, qty: String(a.qty), amountPaise: a.amountPaise });
  }
  const summary: HubBill['summary'] = [{ label: 'Subtotal', amountPaise: b.subtotal }];
  if (b.discount > 0) summary.push({ label: `Discount${doc.discountReason ? ` (${doc.discountReason})` : ''}`, amountPaise: -b.discount });
  if (b.serviceCharge > 0) summary.push({ label: `Service charge${doc.serviceChargeBp ? ` @${pct(doc.serviceChargeBp)}%` : ''}`, amountPaise: b.serviceCharge });
  for (const g of b.taxGroups) {
    if (g.tax === 0) continue;
    if (doc.interState) summary.push({ label: `IGST @${pct(g.rateBp)}%${incl}`, amountPaise: g.igst });
    else summary.push({ label: `CGST @${pct(g.rateBp / 2)}%${incl}`, amountPaise: g.cgst }, { label: `SGST @${pct(g.rateBp / 2)}%${incl}`, amountPaise: g.sgst });
  }
  if (b.roundOff !== 0) summary.push({ label: 'Round off', amountPaise: b.roundOff });
  const place = doc.tableLabel
    ? `Table ${doc.tableLabel}`
    : `${doc.orderType === 'takeaway' ? 'Takeaway' : doc.orderType === 'delivery' ? 'Delivery' : doc.orderType === 'online' ? 'Online order' : 'Dine in'}${doc.orderRef ? ` ${doc.orderRef}` : ''}`;
  const o = doc.outlet;
  const opt = (v: string | null | undefined) => (v ? v : undefined);
  return {
    store: { name: o.name, address: opt(o.addressLines.join(', ')), phone: opt(o.phone), gstin: opt(o.gstin), fssai: opt(o.fssai) },
    title: 'Tax invoice',
    billNo: doc.billNo,
    issuedAt,
    orderLabel: doc.part && doc.part.of > 1 ? `${place} (part ${doc.part.no} of ${doc.part.of})` : place,
    lines,
    summary,
    totalPaise: b.total,
    payments: payments.filter((p) => p.amountPaise !== 0).map((p) => ({ mode: MODE[p.mode] ?? p.mode, amountPaise: p.amountPaise })),
    ...(o.footerLines?.length ? { footer: o.footerLines.join('\n') } : {}),
  };
}

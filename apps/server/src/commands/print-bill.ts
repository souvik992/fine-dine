import { renderBill, type BillDocument } from '@dinepos/printing';
import { calculateBill, couponOff, couponProblem, financialYearAt, formatBillNo, newId, printBillSchema, type BillDiscount } from '@dinepos/shared';
import { defineCommand, type OrderRow } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import { billLogoBits, billOutlet } from './bill-design.js';
import { couponByCode, couponRule, couponUses, type CouponRow } from './coupon-support.js';
import { billableItems, billPrinter, orderPlace, printedDateTime, toBillLines, userName } from './billing-support.js';
import { onlineRef } from '../online/online-support.js';
import { emitTableState, nextCounter } from './order-support.js';
import { salesFacts } from './sales-facts.js';
import { hubBill, shareCode, whatsappQrUrl } from '../cloud/whatsapp-bill.js';

interface ExistingBill {
  id: string;
  fy: string;
  bill_no: number;
  state: string;
}

/**
 * PrintBill (docs/03, docs/08). Assigns the gap-free bill number for the financial year of the print date
 * (decided 2026-11-02), or reuses the number of a bill superseded by later items. Stores the printed document
 * (bill_document revision) and queues it on the bill printer. Always CGST + SGST for dine-in (decided 2026-11-02).
 */
/**
 * Who the bill names: what the cashier typed in the bill dialog, else (takeaway / delivery) who the order was opened
 * for. A delivery always carries its address.
 */
function billCustomer(o: OrderRow, typed: { name: string | null; phone: string | null; gstin: string | null } | null | undefined): BillDocument['customer'] {
  if (o.type !== 'takeaway' && o.type !== 'delivery') return typed ?? null;
  const name = typed?.name ?? o.customer_name ?? null;
  const phone = typed?.phone ?? o.customer_phone ?? null;
  const address = o.type === 'delivery' ? (o.delivery_address ?? null) : null;
  if (!name && !phone && !address && !typed?.gstin) return null;
  return { name, phone, gstin: typed?.gstin ?? null, ...(address ? { address } : {}) };
}

export const printBill = defineCommand({
  type: 'PrintBill',
  schema: printBillSchema,
  right: 'bill.print',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    const { db } = ctx;
    if (o.state === 'billed') throw new PosError('INVALID_STATE', 'The bill is already printed. Reprinting arrives with the next update.', { state: o.state });
    if (o.state !== 'open') throw new PosError('INVALID_STATE', `This order is ${o.state}; it cannot be billed.`, { state: o.state });

    const { items, heldCount } = billableItems(db, o.id);
    if (heldCount > 0) {
      throw new PosError('INVALID_STATE', `${heldCount} item${heldCount > 1 ? 's are' : ' is'} not sent to the kitchen yet. Send or remove them first.`, { heldCount });
    }
    if (items.length === 0) throw new PosError('INVALID_STATE', 'Nothing to bill yet.');

    const cfg = getConfig(db);
    const place = orderPlace(db, o);
    const serviceChargeBp = p.serviceCharge?.enabled ? (p.serviceCharge.rateBp ?? cfg['bill.serviceChargeBp']) : 0;
    const calcOptions = {
      pricingMode: place.pricingMode,
      interState: false,
      serviceChargeBp,
      roundOffStep: cfg['bill.roundOffStep'],
      roundOffTie: cfg['bill.roundOffTie'],
    };

    // A coupon (Settings › Coupons / Offers, as quickPOS) is the bill discount, as an amount: checked against the bill
    // before it (business date, minimum bill, uses), with no manager PIN (the owner approved it when making it).
    let coupon: { row: CouponRow; off: number } | null = null;
    if (p.coupon) {
      const row = couponByCode(db, p.coupon);
      if (!row) throw new PosError('INVALID_STATE', 'No coupon with this code. Check the spelling.', { reason: 'coupon', code: p.coupon });
      const before = calculateBill(toBillLines(items), { ...calcOptions, discount: null });
      const sameBill = (db.prepare('SELECT id FROM bill WHERE order_id = ? AND split_no = 0').pluck().get(o.id) as string | undefined) ?? null;
      const problem = couponProblem(couponRule(row), couponUses(db, row.id, sameBill), ctx.businessDate, before.total);
      if (problem) throw new PosError('INVALID_STATE', problem, { reason: 'coupon', code: row.code });
      coupon = { row, off: couponOff(couponRule(row), before.subtotal) };
    }
    const discountReason = coupon ? `Coupon ${coupon.row.code}` : (p.discount?.reason ?? null);
    const discount: BillDiscount | null = coupon
      ? coupon.off > 0
        ? { kind: 'amount', valuePaise: coupon.off }
        : null
      : p.discount && p.discount.value > 0
        ? p.discount.kind === 'pct'
          ? { kind: 'pct', valueBp: p.discount.value }
          : { kind: 'amount', valuePaise: p.discount.value }
        : null;
    let breakup;
    try {
      breakup = calculateBill(toBillLines(items), { ...calcOptions, discount });
    } catch (e) {
      if (e instanceof RangeError) throw new PosError('VALIDATION', `Cannot apply that discount: ${e.message}.`);
      throw e;
    }

    // Discount above the role's limit needs a manager PIN (docs/07) and is a leakage flag (docs/02).
    let overLimit = false;
    if (breakup.discount > 0 && ctx.actor.userId && !coupon) {
      const limitBp = (db.prepare('SELECT r.discount_limit_bp FROM app_user u JOIN role r ON r.id = u.role_id WHERE u.id = ?').pluck().get(ctx.actor.userId) as number | undefined) ?? 0;
      // Effective discount as a share of the subtotal, rounded up so 10.001% counts as above a 10% limit.
      const requestedBp = Math.ceil((breakup.discount * 10_000) / breakup.subtotal);
      if (requestedBp > limitBp) {
        ctx.approve({ discountBp: requestedBp }, `Discounts above ${limitBp / 100}% need a manager PIN.`);
        overLimit = true;
      }
    }

    // Number: reuse a superseded bill's number, else the next one of this financial year.
    const existing = db.prepare(`SELECT id, fy, bill_no, state FROM bill WHERE order_id = ? AND split_no = 0`).get(o.id) as ExistingBill | undefined;
    let billId: string;
    let billNoText: string;
    let revision: number;
    const customerGstin = p.customer?.gstin ?? null;
    const amounts = [breakup.subtotal, breakup.discount, discountReason, breakup.serviceCharge, breakup.cgst, breakup.sgst, breakup.igst, breakup.roundOff, breakup.total, customerGstin];
    if (existing) {
      if (existing.state !== 'superseded') throw new PosError('INVALID_STATE', 'This order already has a bill.', { billId: existing.id, state: existing.state });
      billId = existing.id;
      const last = db.prepare('SELECT bill_no_text, revision FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').get(billId) as
        | { bill_no_text: string; revision: number }
        | undefined;
      billNoText = last?.bill_no_text ?? formatBillNo(cfg['bill.prefix'], existing.fy, existing.bill_no);
      revision = (last?.revision ?? 0) + 1;
      db.prepare(
        `UPDATE bill SET subtotal_paise = ?, discount_paise = ?, discount_reason = ?, service_charge_paise = ?, cgst_paise = ?,
                sgst_paise = ?, igst_paise = ?, round_off_paise = ?, total_paise = ?, customer_gstin = ?, printed_at = ?,
                print_count = print_count + 1, state = 'printed' WHERE id = ?`,
      ).run(...amounts, ctx.nowIso, billId);
    } else {
      billId = newId();
      const fy = financialYearAt(ctx.now, ctx.timeZone);
      const seq = nextCounter(db, `bill_no:${fy}`);
      billNoText = formatBillNo(cfg['bill.prefix'], fy, seq);
      revision = 1;
      db.prepare(
        `INSERT INTO bill (id, order_id, fy, bill_no, split_no, split_of, subtotal_paise, discount_paise, discount_reason,
                           service_charge_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise, customer_gstin,
                           printed_at, print_count, state)
         VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'printed')`,
      ).run(billId, o.id, fy, seq, ...amounts, ctx.nowIso);
    }

    // Parts of an earlier split that are no longer needed: void, keeping their numbers (decided 2026-11-02).
    for (const id of db.prepare(`SELECT id FROM bill WHERE order_id = ? AND state = 'superseded' AND id <> ?`).pluck().all(o.id, billId) as string[]) {
      db.prepare(`UPDATE bill SET state = 'void' WHERE id = ?`).run(id);
      ctx.audit({ entity: 'bill', entityId: id, action: 'bill.void', before: { state: 'superseded' }, after: { state: 'void' }, reason: 'Split part not needed after the bill was printed again' });
    }
    db.prepare('UPDATE bill SET split_of = 1 WHERE id = ?').run(billId);
    // the coupon this print used (printing again replaces it; a void bill gives the use back)
    db.prepare('DELETE FROM coupon_use WHERE bill_id = ?').run(billId);
    if (coupon) db.prepare('INSERT INTO coupon_use (bill_id, coupon_id, code, discount_paise, used_at) VALUES (?, ?, ?, ?, ?)').run(billId, coupon.row.id, coupon.row.code, breakup.discount, ctx.nowIso);

    if (p.customer) db.prepare('UPDATE "order" SET customer_name = ?, customer_phone = ? WHERE id = ?').run(p.customer.name, p.customer.phone, o.id);
    db.prepare(`UPDATE "order" SET state = 'billed', bill_printed_at = ? WHERE id = ?`).run(ctx.nowIso, o.id);
    db.prepare('DELETE FROM bill_request WHERE order_id = ?').run(o.id); // the captain's request is answered (P3-04)

    const when = printedDateTime(ctx.now, ctx.timeZone);
    const doc: BillDocument = {
      outlet: billOutlet(cfg),
      billNo: billNoText,
      date: when.date,
      time: when.time,
      orderType: o.type,
      tableLabel: place.tableLabel,
      ...(o.type === 'online' ? { orderRef: onlineRef(db, o.id) } : o.ticket_no ? { orderRef: `#${o.ticket_no}` } : {}),
      areaName: place.areaName,
      covers: o.covers,
      captainName: userName(db, o.captain_id),
      cashierName: userName(db, ctx.actor.userId),
      customer: billCustomer(o, p.customer),
      lines: items.map((i) => ({
        name: i.name,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
        amountPaise: i.unitPricePaise * i.qty,
        addons: i.addons.map((a) => ({ name: a.name, qty: a.qty, amountPaise: a.pricePaise * a.qty })),
      })),
      breakup,
      discountReason,
      serviceChargeBp: serviceChargeBp || null,
      interState: false,
      upi: cfg['bill.upiVpa'] ? { vpa: cfg['bill.upiVpa'], payeeName: cfg['bill.upiPayeeName'] ?? cfg['outlet.name'] } : null,
      display: cfg['bill.display'],
    };
    // Bills on WhatsApp: the QR the guest scans (only while linked with PosiNext Cloud); the bill goes up with bill.printed
    const whatsappUrl = cfg['bill.display'].whatsappQr ? whatsappQrUrl(db, billId) : null;
    if (whatsappUrl) doc.whatsappQr = { url: whatsappUrl };
    db.prepare('INSERT INTO bill_document (bill_id, revision, bill_no_text, doc_json, created_at, command_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      billId,
      revision,
      billNoText,
      JSON.stringify(doc),
      ctx.nowIso,
      ctx.commandId,
    );

    const printer = billPrinter(db, cfg);
    if (printer) {
      const { bytes, preview } = renderBill(doc, { paper: printer.paper, logo: billLogoBits(cfg) });
      ctx.print({ printerId: printer.id, docKind: 'bill', refId: billId, bytes, previewText: preview });
    }

    ctx.audit({
      entity: 'bill',
      entityId: billId,
      action: revision === 1 ? 'bill.print' : 'bill.reissue',
      after: { billNo: billNoText, revision, total: breakup.total, discount: breakup.discount, discountReason, serviceCharge: breakup.serviceCharge, ...(coupon ? { coupon: coupon.row.code } : {}) },
      reason: overLimit ? 'discount above role limit (manager PIN)' : null,
      leakage: overLimit,
    });
    // the last five fields feed the portal's Analytics page (sales-facts.ts)
    ctx.outbox('bill.printed', { billId, orderId: o.id, billNo: billNoText, totalPaise: breakup.total, businessDate: ctx.businessDate, ...salesFacts(db, o, items, breakup, ctx.actor.deviceId), ...(whatsappUrl ? { share: { code: shareCode(db, billId), receipt: hubBill(doc, ctx.nowIso) } } : {}) });
    emitTableState(ctx, o.table_id);
    return {
      result: {
        billId,
        billNo: billNoText,
        revision,
        totalPaise: breakup.total,
        printerId: printer?.id ?? null,
        ...(printer ? {} : { warning: 'No bill printer is set up. The bill is saved; add a printer in Settings.' }),
      },
    };
  },
});

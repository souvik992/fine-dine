import { renderBill, type BillDocument } from '@dinepos/printing';
import { calculateBill, financialYearAt, formatBillNo, newId, printBillSchema, type BillDiscount } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import { billableItems, billPrinter, orderPlace, printedDateTime, toBillLines, userName } from './billing-support.js';
import { emitTableState, nextCounter } from './order-support.js';

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
    const discount: BillDiscount | null =
      p.discount && p.discount.value > 0
        ? p.discount.kind === 'pct'
          ? { kind: 'pct', valueBp: p.discount.value }
          : { kind: 'amount', valuePaise: p.discount.value }
        : null;
    const serviceChargeBp = p.serviceCharge?.enabled ? (p.serviceCharge.rateBp ?? cfg['bill.serviceChargeBp']) : 0;

    let breakup;
    try {
      breakup = calculateBill(toBillLines(items), {
        pricingMode: place.pricingMode,
        interState: false,
        discount,
        serviceChargeBp,
        roundOffStep: cfg['bill.roundOffStep'],
        roundOffTie: cfg['bill.roundOffTie'],
      });
    } catch (e) {
      if (e instanceof RangeError) throw new PosError('VALIDATION', `Cannot apply that discount: ${e.message}.`);
      throw e;
    }

    // Number: reuse a superseded bill's number, else the next one of this financial year.
    const existing = db.prepare(`SELECT id, fy, bill_no, state FROM bill WHERE order_id = ? AND split_no = 0`).get(o.id) as ExistingBill | undefined;
    let billId: string;
    let billNoText: string;
    let revision: number;
    const customerGstin = p.customer?.gstin ?? null;
    const amounts = [breakup.subtotal, breakup.discount, p.discount?.reason ?? null, breakup.serviceCharge, breakup.cgst, breakup.sgst, breakup.igst, breakup.roundOff, breakup.total, customerGstin];
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

    if (p.customer) db.prepare('UPDATE "order" SET customer_name = ?, customer_phone = ? WHERE id = ?').run(p.customer.name, p.customer.phone, o.id);
    db.prepare(`UPDATE "order" SET state = 'billed', bill_printed_at = ? WHERE id = ?`).run(ctx.nowIso, o.id);

    const when = printedDateTime(ctx.now, ctx.timeZone);
    const doc: BillDocument = {
      outlet: {
        name: cfg['outlet.name'],
        addressLines: cfg['outlet.addressLines'],
        gstin: cfg['outlet.gstin'],
        fssai: cfg['outlet.fssai'],
        phone: cfg['outlet.phone'],
        footerLines: cfg['bill.footerLines'],
      },
      billNo: billNoText,
      date: when.date,
      time: when.time,
      orderType: o.type,
      tableLabel: place.tableLabel,
      areaName: place.areaName,
      covers: o.covers,
      captainName: userName(db, o.captain_id),
      cashierName: userName(db, ctx.actor.userId),
      customer: p.customer,
      lines: items.map((i) => ({
        name: i.name,
        qty: i.qty,
        unitPricePaise: i.unitPricePaise,
        amountPaise: i.unitPricePaise * i.qty,
        addons: i.addons.map((a) => ({ name: a.name, qty: a.qty, amountPaise: a.pricePaise * a.qty })),
      })),
      breakup,
      discountReason: p.discount?.reason ?? null,
      serviceChargeBp: serviceChargeBp || null,
      interState: false,
      upi: cfg['bill.upiVpa'] ? { vpa: cfg['bill.upiVpa'], payeeName: cfg['bill.upiPayeeName'] ?? cfg['outlet.name'] } : null,
    };
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
      const { bytes, preview } = renderBill(doc, { paper: printer.paper });
      ctx.print({ printerId: printer.id, docKind: 'bill', refId: billId, bytes, previewText: preview });
    }

    ctx.audit({
      entity: 'bill',
      entityId: billId,
      action: revision === 1 ? 'bill.print' : 'bill.reissue',
      after: { billNo: billNoText, revision, total: breakup.total, discount: breakup.discount, discountReason: p.discount?.reason ?? null, serviceCharge: breakup.serviceCharge },
    });
    ctx.outbox('bill.printed', { billId, orderId: o.id, billNo: billNoText, totalPaise: breakup.total });
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

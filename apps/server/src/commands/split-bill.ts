import { renderBill, type BillDocLine, type BillDocument } from '@dinepos/printing';
import {
  calculateBill,
  equalWeights,
  financialYearAt,
  formatBillNo,
  newId,
  proportionWeights,
  splitBillSchema,
  splitBreakup,
  sumPaise,
  type SplitWeights,
} from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import { billLogoBits, billOutlet } from './bill-design.js';
import { billableItems, billPrinter, orderPlace, printedDateTime, toBillLines, userName } from './billing-support.js';
import { emitTableState, nextCounter } from './order-support.js';

interface PrintedBill {
  id: string;
  fy: string;
  bill_no: number;
  split_no: number;
  discount_paise: number;
  discount_reason: string | null;
  customer_gstin: string | null;
  total_paise: number;
}

/**
 * Splits the printed bill into parts (docs/03, docs/08 "Split bills"). The whole bill is worked out once and its
 * per-line figures shared out (splitBreakup), so the parts add up to it exactly; each part is rounded to the
 * outlet's step. Numbers (decided 2026-11-02): the printed bill keeps its number as Part 1, new parts take the next
 * numbers, and on a re-split a part no longer needed is voided (keeps its number). Refused once any part is paid.
 */
export const splitBill = defineCommand({
  type: 'SplitBill',
  schema: splitBillSchema,
  right: 'bill.split',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    const { db } = ctx;
    if (o.state !== 'billed') throw new PosError('INVALID_STATE', o.state === 'open' ? 'Print the bill first (F9), then split it.' : `This order is ${o.state}.`, { state: o.state });
    const paid = db.prepare(`SELECT count(*) FROM bill b WHERE b.order_id = ? AND (b.state = 'settled' OR EXISTS (SELECT 1 FROM payment p WHERE p.bill_id = b.id))`).pluck().get(o.id) as number;
    if (paid > 0) throw new PosError('INVALID_STATE', 'Part of this bill is already paid; it can no longer be split.');
    const printed = db.prepare(`SELECT * FROM bill WHERE order_id = ? AND state = 'printed' ORDER BY fy, bill_no, split_no`).all(o.id) as PrintedBill[];
    if (printed.length === 0) throw new PosError('INVALID_STATE', 'Print the bill first (F9), then split it.');
    const firstDoc = JSON.parse(db.prepare('SELECT doc_json FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').pluck().get(printed[0]!.id) as string) as BillDocument;

    // The whole bill again, with the discount and service charge it was printed with.
    const cfg = getConfig(db);
    const place = orderPlace(db, o);
    const { items } = billableItems(db, o.id);
    const discountPaise = sumPaise(printed.map((b) => b.discount_paise));
    const serviceChargeBp = firstDoc.serviceChargeBp ?? 0;
    const whole = calculateBill(toBillLines(items), {
      pricingMode: place.pricingMode,
      interState: false,
      discount: discountPaise > 0 ? { kind: 'amount', valuePaise: discountPaise } : null,
      serviceChargeBp,
      roundOffStep: cfg['bill.roundOffStep'],
      roundOffTie: cfg['bill.roundOffTie'],
    });
    if (whole.total !== sumPaise(printed.map((b) => b.total_paise))) {
      throw new PosError('INVALID_STATE', 'The order changed since the bill was printed. Print the bill again (F9).');
    }

    // Weights per line and how each part shows the line.
    let weights: SplitWeights;
    let labels: Array<Array<string | null>>; // [line][part] → share text, or null for a whole line
    const n = p.mode === 'equal' ? p.parts : p.parts.length;
    if (p.mode === 'equal') {
      weights = equalWeights(items.length, n);
      labels = items.map(() => weights[0]!.map(() => `1/${n}`));
    } else if (p.mode === 'proportion') {
      const w = p.parts.map((x) => x.weight);
      const sum = w.reduce((a, b) => a + b, 0);
      weights = proportionWeights(items.length, w);
      labels = items.map(() => w.map((x) => `${x}/${sum}`));
    } else {
      const index = new Map(items.map((it, i) => [it.id, i]));
      weights = items.map(() => p.parts.map(() => 0));
      p.parts.forEach((part, k) => {
        for (const a of part.items) {
          const i = index.get(a.orderItemId);
          if (i === undefined) throw new PosError('NOT_FOUND', 'That item is not on this bill.', { orderItemId: a.orderItemId });
          weights[i]![k]! += a.qty;
        }
      });
      const wrong = items.filter((it, i) => weights[i]!.reduce((a, b) => a + b, 0) !== it.qty);
      if (wrong.length) {
        throw new PosError('VALIDATION', `Assign every item exactly once: ${wrong.map((w) => w.name).join(', ')}.`, { orderItemIds: wrong.map((w) => w.id) });
      }
      if (p.parts.some((_, k) => weights.every((row) => row[k] === 0))) throw new PosError('VALIDATION', 'Every part needs at least one item.');
      labels = items.map((it, i) => weights[i]!.map((q) => (q === it.qty ? null : `${q}/${it.qty}`)));
    }
    const parts = splitBreakup(whole, weights, cfg['bill.roundOffStep']);

    // Numbers: reuse the printed bills in order, take new numbers for extra parts, void the ones left over.
    const when = printedDateTime(ctx.now, ctx.timeZone);
    const printer = billPrinter(db, cfg);
    const logo = billLogoBits(cfg);
    const out: Array<{ billId: string; billNo: string; totalPaise: number }> = [];
    const insertDoc = db.prepare('INSERT INTO bill_document (bill_id, revision, bill_no_text, doc_json, created_at, command_id) VALUES (?, ?, ?, ?, ?, ?)');
    parts.forEach((b, k) => {
      const amounts = [b.subtotal, b.discount, printed[0]!.discount_reason, b.serviceCharge, b.cgst, b.sgst, b.igst, b.roundOff, b.total, printed[0]!.customer_gstin];
      const reuse = printed[k];
      let billId: string;
      let billNoText: string;
      let revision: number;
      if (reuse) {
        billId = reuse.id;
        const last = db.prepare('SELECT bill_no_text, revision FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').get(billId) as { bill_no_text: string; revision: number };
        billNoText = last.bill_no_text;
        revision = last.revision + 1;
        db.prepare(
          `UPDATE bill SET subtotal_paise = ?, discount_paise = ?, discount_reason = ?, service_charge_paise = ?, cgst_paise = ?, sgst_paise = ?, igst_paise = ?,
                  round_off_paise = ?, total_paise = ?, customer_gstin = ?, split_of = ?, printed_at = ?, print_count = print_count + 1 WHERE id = ?`,
        ).run(...amounts, n, ctx.nowIso, billId);
      } else {
        billId = newId();
        const fy = financialYearAt(ctx.now, ctx.timeZone);
        const seq = nextCounter(db, `bill_no:${fy}`);
        billNoText = formatBillNo(cfg['bill.prefix'], fy, seq);
        revision = 1;
        db.prepare(
          `INSERT INTO bill (id, order_id, fy, bill_no, split_no, split_of, subtotal_paise, discount_paise, discount_reason, service_charge_paise, cgst_paise,
                             sgst_paise, igst_paise, round_off_paise, total_paise, customer_gstin, printed_at, print_count, state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'printed')`,
        ).run(billId, o.id, fy, seq, k + 1, n, ...amounts, ctx.nowIso);
      }

      const lines: BillDocLine[] = [];
      items.forEach((it, i) => {
        const share = b.lines.find((l) => l.id === it.id);
        if (!share) return;
        const label = labels[i]![k]!;
        lines.push(
          label
            ? { name: it.name, qty: it.qty, qtyText: label, unitPricePaise: whole.lines[i]!.amount, amountPaise: share.amount }
            : {
                name: it.name,
                qty: it.qty,
                unitPricePaise: it.unitPricePaise,
                amountPaise: it.unitPricePaise * it.qty,
                addons: it.addons.map((a) => ({ name: a.name, qty: a.qty, amountPaise: a.pricePaise * a.qty })),
              },
        );
      });
      const doc: BillDocument = {
        ...firstDoc,
        outlet: billOutlet(cfg),
        billNo: billNoText,
        date: when.date,
        time: when.time,
        cashierName: userName(db, ctx.actor.userId),
        lines,
        breakup: b,
        part: { no: k + 1, of: n },
        duplicate: false,
        display: cfg['bill.display'],
      };
      insertDoc.run(billId, revision, billNoText, JSON.stringify(doc), ctx.nowIso, ctx.commandId);
      if (printer) {
        const { bytes, preview } = renderBill(doc, { paper: printer.paper, logo });
        ctx.print({ printerId: printer.id, docKind: 'bill', refId: billId, bytes, previewText: preview });
      }
      out.push({ billId, billNo: billNoText, totalPaise: b.total });
    });

    const voided = printed.slice(n).map((b) => b.id);
    for (const id of voided) {
      db.prepare(`UPDATE bill SET state = 'void' WHERE id = ?`).run(id);
      ctx.audit({ entity: 'bill', entityId: id, action: 'bill.void', before: { state: 'printed' }, after: { state: 'void' }, reason: 'Not needed after re-splitting the bill' });
    }
    ctx.audit({ entity: 'order', entityId: o.id, action: 'bill.split', after: { mode: p.mode, parts: out, voided, wholeTotalPaise: whole.total } });
    emitTableState(ctx, o.table_id);
    return { result: { bills: out, ...(printer ? {} : { warning: 'No bill printer is set up; the parts were saved but not printed.' }) } };
  },
});

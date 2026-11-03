import { renderBill, type BillDocument } from '@dinepos/printing';
import { newId, voidBillSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import { billLogoBits } from './bill-design.js';
import { billPrinter, printedDateTime } from './billing-support.js';
import { emitTableState } from './order-support.js';

/**
 * Voids a printed or settled bill of the current business date (docs/03, docs/08): the bill keeps its number and
 * shows VOID in reports, its payments are reversed with negative rows (payments are append-only), and a VOID copy
 * prints. The order becomes void once none of its bills is live; a part of a split is voided on its own. Food
 * already made stays used (stock is not returned). Leakage flag; a manager PIN when the role needs one.
 */
export const voidBill = defineCommand({
  type: 'VoidBill',
  schema: voidBillSchema,
  right: 'bill.void',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    const { db } = ctx;
    const bill = db.prepare('SELECT id, state, total_paise FROM bill WHERE id = ? AND order_id = ?').get(p.billId, o.id) as
      | { id: string; state: string; total_paise: number }
      | undefined;
    if (!bill) throw new PosError('NOT_FOUND', 'That bill is not on this order.', { billId: p.billId });
    if (bill.state !== 'printed' && bill.state !== 'settled') {
      throw new PosError('INVALID_STATE', bill.state === 'void' ? 'This bill is already void.' : 'This bill was replaced by a newer print; void that one.', { state: bill.state });
    }
    if (o.business_date !== ctx.businessDate) {
      throw new PosError('INVALID_STATE', `This bill belongs to ${o.business_date}, a closed day. Only today's bills can be voided.`, { businessDate: o.business_date });
    }

    const payments = db.prepare('SELECT mode, amount_paise FROM payment WHERE bill_id = ? AND amount_paise > 0 ORDER BY rowid').all(bill.id) as Array<{ mode: string; amount_paise: number }>;
    const reverse = db.prepare('INSERT INTO payment (id, bill_id, mode, amount_paise, ref, received_by, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const pay of payments) reverse.run(newId(), bill.id, pay.mode, -pay.amount_paise, `VOID: ${p.reason}`.slice(0, 120), ctx.actor.userId, ctx.nowIso);
    db.prepare(`UPDATE bill SET state = 'void' WHERE id = ?`).run(bill.id);

    const left = db.prepare(`SELECT state, count(*) AS n FROM bill WHERE order_id = ? AND state IN ('printed', 'settled') GROUP BY state`).all(o.id) as Array<{ state: string; n: number }>;
    const has = (s: string) => left.some((r) => r.state === s);
    const nextState = has('printed') ? 'billed' : has('settled') ? 'settled' : 'void';
    if (nextState !== o.state) {
      db.prepare('UPDATE "order" SET state = ?, closed_at = coalesce(closed_at, ?) WHERE id = ?').run(nextState, nextState === 'billed' ? null : ctx.nowIso, o.id);
    }
    if (nextState !== 'billed') db.prepare('UPDATE dining_table SET open_order_id = NULL WHERE open_order_id = ?').run(o.id);

    const stored = db.prepare('SELECT doc_json, bill_no_text FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').get(bill.id) as
      | { doc_json: string; bill_no_text: string }
      | undefined;
    const cfg = getConfig(db);
    const printer = billPrinter(db, cfg);
    const when = printedDateTime(ctx.now, ctx.timeZone);
    if (stored && printer) {
      const doc = { ...(JSON.parse(stored.doc_json) as BillDocument), voided: { reason: p.reason, at: `${when.date} ${when.time}` } };
      const { bytes, preview } = renderBill(doc, { paper: printer.paper, logo: billLogoBits(cfg) });
      ctx.print({ printerId: printer.id, docKind: 'bill', refId: bill.id, bytes, previewText: preview });
    }
    ctx.audit({
      entity: 'bill',
      entityId: bill.id,
      action: 'bill.void',
      before: { state: bill.state, totalPaise: bill.total_paise, payments },
      after: { state: 'void', billNo: stored?.bill_no_text ?? null, orderState: nextState },
      reason: p.reason,
      leakage: true,
    });
    ctx.outbox('bill.voided', { billId: bill.id, orderId: o.id, billNo: stored?.bill_no_text ?? null, totalPaise: bill.total_paise, reason: p.reason });
    emitTableState(ctx, o.table_id);
    return { result: { billId: bill.id, billNo: stored?.bill_no_text ?? null, refundPaise: payments.reduce((s, x) => s + x.amount_paise, 0), orderState: nextState } };
  },
});

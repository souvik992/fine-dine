import { formatINR, newId, settleSchema, type PaymentMode } from '@dinepos/shared';
import type { OrderRow } from '../core/command-handler.js';
import { defineCommand } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { emitTableState } from './order-support.js';

export interface Tender {
  mode: PaymentMode;
  amountPaise: number;
  ref: string | null;
}

/**
 * Settles a printed bill with these tenders (Settle; and accepting an online order paid online, P4-06, mode 'online').
 * Tenders must cover the bill exactly; only cash may exceed it and the excess is change. Closes the order and frees the
 * table when no part is left unpaid.
 */
export function settleBill(ctx: CommandContext, o: OrderRow, billId: string, tenders: readonly Tender[]): { billId: string; paidPaise: number; changePaise: number; unpaidParts: number } {
  const { db } = ctx;
  const bill = db.prepare('SELECT id, state, total_paise, fy, bill_no FROM bill WHERE id = ? AND order_id = ?').get(billId, o.id) as
    | { id: string; state: string; total_paise: number; fy: string; bill_no: number }
    | undefined;
  if (!bill) throw new PosError('NOT_FOUND', 'That bill is not on this order.', { billId });
  if (bill.state !== 'printed' || o.state !== 'billed') {
    const why = bill.state === 'superseded' ? 'Items were added after it was printed; print the bill again.' : `The bill is ${bill.state}.`;
    throw new PosError('INVALID_STATE', why, { billState: bill.state, orderState: o.state });
  }

  const total = bill.total_paise;
  const cash = tenders.filter((t) => t.mode === 'cash').reduce((s, t) => s + t.amountPaise, 0);
  const nonCash = tenders.filter((t) => t.mode !== 'cash');
  const nonCashTotal = nonCash.reduce((s, t) => s + t.amountPaise, 0);
  if (nonCashTotal > total) {
    throw new PosError('VALIDATION', `Card, UPI and other payments add up to more than the bill (${formatINR(total)}). Only cash can give change.`);
  }
  const paid = cash + nonCashTotal;
  if (paid < total) throw new PosError('INVALID_STATE', `${formatINR(total - paid)} is still to be paid.`, { shortPaise: total - paid });
  const change = paid - total; // ≤ cash, because non-cash ≤ total

  if (tenders.some((t) => t.mode === 'due')) {
    const who = db.prepare('SELECT customer_name, customer_phone FROM "order" WHERE id = ?').get(o.id) as { customer_name: string | null; customer_phone: string | null };
    if (!who.customer_name && !who.customer_phone) {
      throw new PosError('INVALID_STATE', 'Add the guest’s name or phone on the bill before marking it as due.');
    }
  }

  const insert = db.prepare('INSERT INTO payment (id, bill_id, mode, amount_paise, ref, received_by, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const t of nonCash) insert.run(newId(), bill.id, t.mode, t.amountPaise, t.ref, ctx.actor.userId, ctx.nowIso);
  if (cash - change > 0) insert.run(newId(), bill.id, 'cash', cash - change, null, ctx.actor.userId, ctx.nowIso);

  db.prepare(`UPDATE bill SET state = 'settled' WHERE id = ?`).run(bill.id);
  // A split bill (P2-05): the order closes and the table frees when the last part is paid.
  const unpaidParts = db.prepare(`SELECT count(*) FROM bill WHERE order_id = ? AND state = 'printed'`).pluck().get(o.id) as number;
  if (unpaidParts === 0) {
    db.prepare(`UPDATE "order" SET state = 'settled', closed_at = ? WHERE id = ?`).run(ctx.nowIso, o.id);
    db.prepare('UPDATE dining_table SET open_order_id = NULL WHERE open_order_id = ?').run(o.id);
  }

  const complimentary = tenders.some((t) => t.mode === 'complimentary');
  ctx.audit({
    entity: 'bill',
    entityId: bill.id,
    action: 'bill.settle',
    after: { totalPaise: total, tenders, changePaise: change },
    reason: complimentary ? tenders.find((t) => t.mode === 'complimentary')!.ref : null,
    leakage: complimentary,
  });
  ctx.outbox('bill.settled', { billId: bill.id, orderId: o.id, totalPaise: total, tenders: tenders.map((t) => ({ mode: t.mode, amountPaise: t.amountPaise })), changePaise: change });
  emitTableState(ctx, o.table_id);
  return { billId: bill.id, paidPaise: paid, changePaise: change, unpaidParts };
}

/**
 * Settle (docs/03, docs/09 §3): what the cashier takes (any TENDER_MODES; not 'online'). Payment rows are append-only
 * (migration 0003).
 */
export const settle = defineCommand({
  type: 'Settle',
  schema: settleSchema,
  right: 'bill.settle',
  needsOrder: true,
  apply(ctx, p, order) {
    return { result: settleBill(ctx, order!, p.billId, p.tenders) };
  },
});

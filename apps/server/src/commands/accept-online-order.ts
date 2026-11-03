import { acceptOnlineOrderSchema, fireKotSchema, formatINR, newId, printBillSchema } from '@dinepos/shared';
import { defineCommand, type OrderRow } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { getConfig } from '../core/outlet-config.js';
import { loadOrderRow } from '../queries/order-snapshot.js';
import { priceOnlineOrder } from '../online/menu.js';
import { enqueueHubAction, hubOrder, requireOnline, setOnlineState } from '../online/online-support.js';
import { fireKot } from './fire-kot.js';
import { orderItemContext, priceAddons, priceItem, writeAddons } from './order-support.js';
import { printBill } from './print-bill.js';
import { settleBill } from './settle.js';

interface AcceptResult {
  orderId: string;
  billId: string | null;
  billNo: string | null;
  totalPaise: number | null;
}

const reload = (db: Parameters<typeof loadOrderRow>[0], id: string): OrderRow => loadOrderRow(db, id)!;

/**
 * Accepts an online order (P4-06): in one transaction, an order with no table is opened, its dishes go to the kitchen
 * (KOT), the delivery and packaging charges are added, and the GST bill is printed at DinePOS prices (no service
 * charge, no discount); an order paid online is settled as 'online'. Then the hub is told (outbox: prep time and bill
 * number). If DinePOS's total is not what the customer was shown, it is refused unless staff accept the DinePOS price
 * (product owner, 2026-11-03); automatic accepting never does that.
 */
export const acceptOnlineOrder = defineCommand({
  type: 'AcceptOnlineOrder',
  schema: acceptOnlineOrderSchema,
  right: 'online.orders',
  needsOrder: false,
  apply(ctx, p): { orderId: string; result: AcceptResult } {
    const { db } = ctx;
    const oo = requireOnline(ctx, p.onlineOrderId);
    if (oo.local_order_id) {
      // Accepted already (a retry, or another terminal): the same answer.
      const billNo = oo.bill_id ? ((db.prepare('SELECT bill_no_text FROM bill_document WHERE bill_id = ? ORDER BY revision DESC LIMIT 1').pluck().get(oo.bill_id) as string | undefined) ?? null) : null;
      return { orderId: oo.local_order_id, result: { orderId: oo.local_order_id, billId: oo.bill_id, billNo, totalPaise: oo.pos_total_paise } };
    }
    if (oo.state !== 'SENT_TO_STORE' && oo.state !== 'RECEIVED') {
      throw new PosError('INVALID_STATE', `This order can no longer be accepted (${oo.state.toLowerCase().replace(/_/g, ' ')}).`, { state: oo.state });
    }
    const cfg = getConfig(db);
    const settings = cfg['online.settings'];
    const order = hubOrder(oo);
    const priced = priceOnlineOrder(db, order, settings, cfg);
    if ((priced.differs || priced.problem) && !p.acceptPriceChange) {
      throw new PosError(
        'INVALID_STATE',
        priced.problem ?? `At today's prices the bill is ${formatINR(priced.totalPaise)}; the customer was shown ${formatINR(order.total)}. Accept at the DinePOS price, or reject.`,
        { reason: 'price', posTotalPaise: priced.totalPaise, customerTotalPaise: order.total, problem: priced.problem },
      );
    }
    const prep = p.prepMinutes ?? (order.fulfilment === 'PICKUP' ? settings.serviceability.pickup.etaMinutes : settings.prepMinutes);

    // 1. The DinePOS order (no table), linked first: its KOT and bill print the online order's number.
    const orderId = newId();
    db.prepare(
      `INSERT INTO "order" (id, business_date, table_id, type, covers, captain_id, customer_name, customer_phone, state, version, opened_at, opened_by)
       VALUES (?, ?, NULL, 'online', NULL, NULL, ?, ?, 'open', 1, ?, ?)`,
    ).run(orderId, ctx.businessDate, order.customer.name?.slice(0, 60) ?? null, order.customer.mobile, ctx.nowIso, ctx.actor.userId);
    db.prepare('UPDATE online_order SET local_order_id = ? WHERE id = ?').run(orderId, oo.id);
    ctx.audit({ entity: 'order', entityId: orderId, action: 'order.open', after: { type: 'online', onlineOrderId: oo.id, number: oo.number } });

    // 2. Dishes at DinePOS prices, then the KOT.
    const ictx = orderItemContext(db, reload(db, orderId));
    const insert = db.prepare(
      `INSERT INTO order_item (id, order_id, item_id, variant_id, name_snapshot, qty, unit_price_paise, tax_rate_bp, note, course, status, added_by, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const l of priced.lines) {
      const id = newId();
      const item = priceItem(db, ictx, l.itemId, l.variantId);
      insert.run(id, orderId, item.itemId, item.variantId, item.nameSnapshot, l.qty, item.unitPricePaise, item.taxRateBp, l.note, 1, 'held', ctx.actor.userId, ctx.nowIso);
      writeAddons(db, id, priceAddons(db, l.itemId, l.addons.map((a) => ({ addonId: a.addonId, qty: a.qty }))));
    }
    fireKot.apply(ctx, fireKotSchema.parse({ all: true }), reload(db, orderId));

    // 3. Charges: on the bill, never on a KOT.
    for (const f of priced.fees) insert.run(newId(), orderId, `fee:${f.kind}`, null, f.name, 1, f.pricePaise, f.taxRateBp, null, 1, 'fired', ctx.actor.userId, ctx.nowIso);

    // 4. The GST bill, then payment when it was paid online.
    const billed = printBill.apply(ctx, printBillSchema.parse({ customer: { name: order.customer.name?.slice(0, 60) ?? null, phone: order.customer.mobile } }), reload(db, orderId)) as { result: { billId: string; billNo: string; totalPaise: number } };
    const { billId, billNo, totalPaise } = billed.result;
    if (order.payment === 'ONLINE' && order.paid) {
      const ref = `${oo.number}${totalPaise !== order.total ? ` (customer paid ${formatINR(order.total)})` : ''}`.slice(0, 60);
      settleBill(ctx, reload(db, orderId), billId, [{ mode: 'online', amountPaise: totalPaise, ref }]);
    }

    // 5. Accepted here; the hub hears it after commit (retried until it answers).
    db.prepare('UPDATE online_order SET bill_id = ?, pos_total_paise = ?, accepted_by = ? WHERE id = ?').run(billId, totalPaise, ctx.actor.userId, oo.id);
    const alert = totalPaise !== order.total ? `Billed at the DinePOS price ${formatINR(totalPaise)} (the customer was shown ${formatINR(order.total)}).` : null;
    setOnlineState(ctx, oo.id, 'ACCEPTED', { alert, prepMinutes: prep });
    enqueueHubAction(ctx, oo.id, 'accept', { prepMinutes: prep, posBillNo: billNo }, `acc-${oo.id}`);
    ctx.audit({ entity: 'online_order', entityId: oo.id, action: 'online.accept', after: { orderId, billNo, totalPaise, customerTotalPaise: order.total, prepMinutes: prep, priceAccepted: p.acceptPriceChange } });
    return { orderId, result: { orderId, billId, billNo, totalPaise } };
  },
});

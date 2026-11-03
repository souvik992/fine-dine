import { applyHubEventSchema, HUB_ORDER_STATES, type HubEvent, type HubOrder } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { enqueueHubAction, findOnline, linkRow, onlineChanged, setOnlineState } from '../online/online-support.js';

/**
 * Internal (P4-06): one event from the hub's stream, applied once — events at or below the stored number are ignored
 * (at-least-once delivery, contract F4). A new order is stored before it is confirmed (`received` in the outbox), so
 * nothing is lost if the server stops (F3). Updates the resume point in the same transaction.
 */
export const applyHubEvent = defineCommand({
  type: 'ApplyHubEvent',
  schema: applyHubEventSchema,
  right: null,
  needsOrder: false,
  allowWhenDayClosed: true,
  internal: true,
  apply(ctx, p) {
    const ev = p.event as unknown as HubEvent;
    if (!Number.isSafeInteger(ev.seq) || ev.seq < 1 || typeof ev.type !== 'string') throw new PosError('VALIDATION', 'Not a hub event.');
    const { db } = ctx;
    if (ev.seq <= linkRow(db).last_seq) return { result: { applied: false } };

    if (ev.type === 'order.created') {
      const o: HubOrder = ev.order;
      if (!o || typeof o.id !== 'string' || !HUB_ORDER_STATES.includes(o.state)) throw new PosError('VALIDATION', 'The hub sent an order this server cannot read.');
      if (!findOnline(db, o.id)) {
        db.prepare('INSERT INTO online_order (id, number, state, order_json, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(o.id, o.number, o.state, JSON.stringify(o), ctx.nowIso, ctx.nowIso);
        enqueueHubAction(ctx, o.id, 'received', {}, `rcv-${o.id}`);
        ctx.audit({ entity: 'online_order', entityId: o.id, action: 'online.received', after: { number: o.number, total: o.total, fulfilment: o.fulfilment, payment: o.payment } });
        onlineChanged(ctx, o.id);
      }
    } else if (ev.type === 'order.cancelled' || ev.type === 'order.auto_rejected') {
      const o = findOnline(db, ev.orderId);
      if (o) {
        const who = ev.type === 'order.auto_rejected' ? 'Not accepted in time: the hub rejected it.' : 'The customer cancelled.';
        const bill = o.bill_id ? ' Its bill was already printed: void it (Cancel order).' : '';
        setOnlineState(ctx, o.id, ev.type === 'order.auto_rejected' ? 'AUTO_REJECTED' : 'CANCELLED', { alert: `${who}${bill}`, ...(ev.type === 'order.cancelled' ? { reasonText: ev.reasonText } : {}) });
      }
    } else if (ev.type === 'order.updated') {
      const o = findOnline(db, ev.orderId);
      if (o && o.state !== ev.state && HUB_ORDER_STATES.includes(ev.state)) setOnlineState(ctx, o.id, ev.state);
    }
    db.prepare('UPDATE online_link SET last_seq = ? WHERE id = 1').run(ev.seq);
    return { result: { applied: true } };
  },
});

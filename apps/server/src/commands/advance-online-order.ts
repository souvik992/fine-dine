import { advanceOnlineOrderSchema, type HubOrderState } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { loadOrderRow } from '../queries/order-snapshot.js';
import { enqueueHubAction, hubOrder, requireOnline, setOnlineState } from '../online/online-support.js';
import { settleBill } from './settle.js';

/** What the store may do next (contract `TRANSITIONS`, actor 'pos', own riders). */
const NEXT: Record<string, { from: readonly HubOrderState[]; fulfilment?: 'PICKUP' | 'DELIVERY' }> = {
  PREPARING: { from: ['ACCEPTED'] },
  READY: { from: ['ACCEPTED', 'PREPARING'] },
  OUT_FOR_DELIVERY: { from: ['READY'], fulfilment: 'DELIVERY' },
  DELIVERED: { from: ['OUT_FOR_DELIVERY'], fulfilment: 'DELIVERY' },
  PICKED_UP: { from: ['READY'], fulfilment: 'PICKUP' },
};

/**
 * Moves an accepted online order on (P4-06): preparing, ready, out for delivery (with the rider), delivered or picked
 * up. Delivered / picked up settles a cash-on-delivery bill in cash (the cash was collected). The hub tells the customer.
 */
export const advanceOnlineOrder = defineCommand({
  type: 'AdvanceOnlineOrder',
  schema: advanceOnlineOrderSchema,
  right: 'online.orders',
  needsOrder: false,
  apply(ctx, p) {
    const oo = requireOnline(ctx, p.onlineOrderId);
    const order = hubOrder(oo);
    const rule = NEXT[p.to]!;
    if (!rule.from.includes(oo.state) || (rule.fulfilment && rule.fulfilment !== order.fulfilment)) {
      throw new PosError('INVALID_STATE', `A ${order.fulfilment.toLowerCase()} order cannot go from ${oo.state.toLowerCase().replace(/_/g, ' ')} to ${p.to.toLowerCase().replace(/_/g, ' ')}.`, { state: oo.state, to: p.to });
    }
    if (p.to === 'OUT_FOR_DELIVERY' && !p.rider) throw new PosError('VALIDATION', 'Enter the rider’s name.', { field: 'rider' });

    if ((p.to === 'DELIVERED' || p.to === 'PICKED_UP') && order.payment === 'COD' && oo.local_order_id && oo.bill_id) {
      const local = loadOrderRow(ctx.db, oo.local_order_id);
      const bill = ctx.db.prepare('SELECT state, total_paise FROM bill WHERE id = ?').get(oo.bill_id) as { state: string; total_paise: number } | undefined;
      if (local && bill?.state === 'printed') settleBill(ctx, local, oo.bill_id, [{ mode: 'cash', amountPaise: bill.total_paise, ref: null }]);
    }
    setOnlineState(ctx, oo.id, p.to, { ...(p.rider ? { rider: p.rider } : {}) });
    enqueueHubAction(ctx, oo.id, 'state', { to: p.to, ...(p.rider ? { rider: p.rider } : {}) }, `st-${oo.id}-${p.to}`);
    ctx.audit({ entity: 'online_order', entityId: oo.id, action: 'online.state', before: { state: oo.state }, after: { state: p.to, rider: p.rider } });
    return { result: { state: p.to } };
  },
});

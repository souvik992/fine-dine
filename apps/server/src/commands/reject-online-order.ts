import { rejectOnlineOrderSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { enqueueHubAction, requireOnline, setOnlineState } from '../online/online-support.js';

/** Rejects a new online order with a reason (P4-06); the hub refunds an online payment and tells the customer. */
export const rejectOnlineOrder = defineCommand({
  type: 'RejectOnlineOrder',
  schema: rejectOnlineOrderSchema,
  right: 'online.orders',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const oo = requireOnline(ctx, p.onlineOrderId);
    if (oo.state !== 'SENT_TO_STORE' && oo.state !== 'RECEIVED') {
      throw new PosError('INVALID_STATE', oo.local_order_id ? 'This order was accepted; cancel it instead.' : `This order is already ${oo.state.toLowerCase().replace(/_/g, ' ')}.`, { state: oo.state });
    }
    setOnlineState(ctx, oo.id, 'REJECTED', { alert: null, reasonText: p.reasonText });
    enqueueHubAction(ctx, oo.id, 'reject', { reason: p.reason, reasonText: p.reasonText }, `rej-${oo.id}`);
    ctx.audit({ entity: 'online_order', entityId: oo.id, action: 'online.reject', after: { reason: p.reason, reasonText: p.reasonText } });
    return { result: { state: 'REJECTED' } };
  },
});

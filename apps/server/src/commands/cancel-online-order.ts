import { cancelOnlineOrderSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { loadOrderRow } from '../queries/order-snapshot.js';
import { enqueueHubAction, requireOnline, setOnlineState } from '../online/online-support.js';
import { voidBill } from './void-bill.js';

/**
 * Cancels an online order after it was accepted (P4-06): its bill is voided (it keeps its number; payments are
 * reversed) — so this needs the bill.void right, with a manager PIN when the role needs one. Also used when the
 * customer cancelled or the hub refused the accept after the bill was printed. The hub refunds an online payment.
 */
export const cancelOnlineOrder = defineCommand({
  type: 'CancelOnlineOrder',
  schema: cancelOnlineOrderSchema,
  right: 'bill.void',
  needsOrder: false,
  apply(ctx, p) {
    const oo = requireOnline(ctx, p.onlineOrderId);
    const hubClosed = oo.state === 'CANCELLED' || oo.state === 'AUTO_REJECTED' || oo.state === 'REJECTED';
    if (!oo.local_order_id || !oo.bill_id) {
      throw new PosError('INVALID_STATE', hubClosed ? 'Nothing to cancel: this order was never billed.' : 'This order was not accepted yet; reject it instead.', { state: oo.state });
    }
    if (oo.state === 'DELIVERED' || oo.state === 'PICKED_UP') throw new PosError('INVALID_STATE', 'This order is finished; void its bill from Bills if needed.', { state: oo.state });
    const bill = ctx.db.prepare('SELECT state FROM bill WHERE id = ?').pluck().get(oo.bill_id) as string | undefined;
    if (bill !== 'void') voidBill.apply(ctx, { billId: oo.bill_id, reason: `${oo.number}: ${p.reason}`.slice(0, 120) }, loadOrderRow(ctx.db, oo.local_order_id)!);
    setOnlineState(ctx, oo.id, 'CANCELLED', { alert: null, reasonText: p.reason });
    if (!hubClosed) enqueueHubAction(ctx, oo.id, 'state', { to: 'CANCELLED', reasonText: p.reason }, `st-${oo.id}-CANCELLED`);
    ctx.audit({ entity: 'online_order', entityId: oo.id, action: 'online.cancel', after: { reason: p.reason, billVoided: bill !== 'void' }, leakage: true });
    return { result: { state: 'CANCELLED' } };
  },
});

import { recordHubActionSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { findOnline, onlineChanged, setOnlineState } from '../online/online-support.js';

/**
 * Internal (P4-06): what the hub answered to one outbox action. `failed` (network, hub error) keeps it for a retry;
 * `refused` (409/404/400) is final — an accept refused because the customer cancelled first (contract F11) leaves the
 * order cancelled with a note to void its bill.
 */
export const recordHubAction = defineCommand({
  type: 'RecordHubAction',
  schema: recordHubActionSchema,
  right: null,
  needsOrder: false,
  allowWhenDayClosed: true,
  internal: true,
  apply(ctx, p) {
    const row = ctx.db.prepare('SELECT id, order_id, action, done_at FROM online_outbox WHERE id = ?').get(p.outboxId) as
      | { id: number; order_id: string; action: string; done_at: string | null }
      | undefined;
    if (!row) throw new PosError('NOT_FOUND', 'No such hub action.', { outboxId: p.outboxId });
    if (row.done_at) return { result: { status: 'already done' } };
    if (p.outcome === 'failed') {
      ctx.db.prepare('UPDATE online_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(p.message, row.id);
      return { result: { status: 'will retry' } };
    }
    ctx.db.prepare('UPDATE online_outbox SET attempts = attempts + 1, done_at = ?, result = ? WHERE id = ?').run(ctx.nowIso, p.outcome === 'refused' ? `refused: ${p.message ?? ''}` : 'ok', row.id);
    if (p.outcome === 'refused' && row.action === 'accept') {
      const o = findOnline(ctx.db, row.order_id);
      if (o) setOnlineState(ctx, o.id, p.state ?? 'CANCELLED', { alert: `The hub refused the accept (${p.message ?? 'the order was closed'}). Void its bill: Cancel order.` });
    } else onlineChanged(ctx, row.order_id);
    ctx.audit({ entity: 'online_order', entityId: row.order_id, action: `online.hub_${p.outcome}`, after: { action: row.action, message: p.message } });
    return { result: { status: p.outcome } };
  },
});

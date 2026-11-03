import { assignCaptainSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { requireActiveUser } from './captain-support.js';
import { emitTableState, requireEditable } from './order-support.js';

/** The captain looking after this order (docs/03 AssignCaptain, P3-04); null clears it. */
export const assignCaptain = defineCommand({
  type: 'AssignCaptain',
  schema: assignCaptainSchema,
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    requireEditable(o);
    if (p.captainId) requireActiveUser(ctx.db, p.captainId);
    if (o.captain_id === p.captainId) return { result: { captainId: p.captainId } };
    ctx.db.prepare('UPDATE "order" SET captain_id = ? WHERE id = ?').run(p.captainId, o.id);
    ctx.audit({ entity: 'order', entityId: o.id, action: 'order.captain', before: { captainId: o.captain_id }, after: { captainId: p.captainId } });
    emitTableState(ctx, o.table_id);
    return { result: { captainId: p.captainId } };
  },
});

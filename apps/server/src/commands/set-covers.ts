import { setCoversSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { emitTableState } from './order-support.js';

/** Guests at the table (P3-02). Not after the bill is printed: the bill shows the covers. */
export const setCovers = defineCommand({
  type: 'SetCovers',
  schema: setCoversSchema,
  right: 'order.edit',
  needsOrder: true,
  apply(ctx, p, order) {
    const o = order!;
    if (o.state !== 'open') {
      const why = o.state === 'billed' ? 'the bill is already printed' : `this order is ${o.state}`;
      throw new PosError('INVALID_STATE', `Guests cannot change: ${why}.`, { state: o.state });
    }
    if (o.covers === p.covers) return { result: { covers: p.covers } };
    ctx.db.prepare('UPDATE "order" SET covers = ? WHERE id = ?').run(p.covers, o.id);
    ctx.audit({ entity: 'order', entityId: o.id, action: 'order.covers', before: { covers: o.covers }, after: { covers: p.covers } });
    emitTableState(ctx, o.table_id);
    return { result: { covers: p.covers } };
  },
});

import { kotStatusSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { kotLabel, kotStatusChanged, requireKot } from './kds-support.js';

/**
 * Second bump (or the captain): the food went to the table and the ticket leaves the screen. A ticket served
 * without a first bump counts as ready at the same moment, so kitchen times stay complete.
 */
export const markKotServed = defineCommand({
  type: 'MarkKotServed',
  schema: kotStatusSchema,
  right: 'kds.bump',
  needsOrder: false,
  apply(ctx, p) {
    const kot = requireKot(ctx, p.kotId);
    if (kot.served_at) throw new PosError('INVALID_STATE', `${kotLabel(kot)} was already served.`, { kotId: kot.id });
    ctx.db.prepare('UPDATE kot SET ready_at = coalesce(ready_at, @at), served_at = @at WHERE id = @id').run({ at: ctx.nowIso, id: kot.id });
    kotStatusChanged(ctx, kot, 'served', 'kot.served', { status: kot.ready_at ? 'ready' : 'new' });
    return { result: { kotId: kot.id, status: 'served', servedAt: ctx.nowIso } };
  },
});

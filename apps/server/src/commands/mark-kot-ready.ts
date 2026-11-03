import { kotStatusSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { kotLabel, kotStatusChanged, requireKot } from './kds-support.js';

/** First bump on the kitchen screen: the ticket is cooked and waiting to go out (docs/06 KDS). */
export const markKotReady = defineCommand({
  type: 'MarkKotReady',
  schema: kotStatusSchema,
  right: 'kds.bump',
  needsOrder: false,
  apply(ctx, p) {
    const kot = requireKot(ctx, p.kotId);
    if (kot.served_at) throw new PosError('INVALID_STATE', `${kotLabel(kot)} was already served.`, { kotId: kot.id });
    if (kot.ready_at) throw new PosError('INVALID_STATE', `${kotLabel(kot)} is already ready.`, { kotId: kot.id });
    ctx.db.prepare('UPDATE kot SET ready_at = ? WHERE id = ?').run(ctx.nowIso, kot.id);
    kotStatusChanged(ctx, kot, 'ready', 'kot.ready', { status: 'new' });
    return { result: { kotId: kot.id, status: 'ready', readyAt: ctx.nowIso } };
  },
});

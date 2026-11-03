import { kotStatusSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { kotLabel, kotStatusChanged, requireKot } from './kds-support.js';

/** Undo a bump made by mistake: a ready or served ticket goes back to the "New" column. Audited. */
export const recallKot = defineCommand({
  type: 'RecallKot',
  schema: kotStatusSchema,
  right: 'kds.bump',
  needsOrder: false,
  apply(ctx, p) {
    const kot = requireKot(ctx, p.kotId);
    if (!kot.ready_at && !kot.served_at) throw new PosError('INVALID_STATE', `${kotLabel(kot)} has not been bumped.`, { kotId: kot.id });
    ctx.db.prepare('UPDATE kot SET ready_at = NULL, served_at = NULL WHERE id = ?').run(kot.id);
    kotStatusChanged(ctx, kot, 'new', 'kot.recall', { status: kot.served_at ? 'served' : 'ready', readyAt: kot.ready_at, servedAt: kot.served_at });
    return { result: { kotId: kot.id, status: 'new' } };
  },
});

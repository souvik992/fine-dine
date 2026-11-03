import { recordSyncAckSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { syncStream } from '../sync/sync-support.js';

/**
 * Internal (P4-05): the hub holds this outlet's outbox up to `ackSeq`, so those rows are marked sent. `rewind` (the hub
 * reported a gap: it lost records, e.g. it was restored from a backup) also marks the later rows unsent, to send again.
 * An answer for a stream this outlet no longer uses (ResetSyncStream ran meanwhile) changes nothing.
 */
export const recordSyncAck = defineCommand({
  type: 'RecordSyncAck',
  schema: recordSyncAckSchema,
  right: null,
  needsOrder: false,
  allowWhenDayClosed: true,
  internal: true,
  apply(ctx, p) {
    if (syncStream(ctx.db).streamId !== p.streamId) return { result: { marked: 0, unmarked: 0, status: 'old stream' } };
    const marked = ctx.db.prepare('UPDATE outbox SET sent_at = ? WHERE seq <= ? AND sent_at IS NULL').run(ctx.nowIso, p.ackSeq).changes;
    const unmarked = p.rewind ? ctx.db.prepare('UPDATE outbox SET sent_at = NULL WHERE seq > ? AND sent_at IS NOT NULL').run(p.ackSeq).changes : 0;
    if (unmarked > 0) ctx.audit({ entity: 'sync', entityId: p.streamId, action: 'sync.rewind', after: { ackSeq: p.ackSeq, resend: unmarked } });
    return { result: { marked, unmarked, status: 'ok' } };
  },
});

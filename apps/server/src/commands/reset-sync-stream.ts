import { randomBytes } from 'node:crypto';
import { resetSyncStreamSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { linkRow } from '../online/online-support.js';
import { syncStream } from '../sync/sync-support.js';

/**
 * Starts a new sync stream (P4-05): for when the hub holds different records under numbers this outlet already used
 * (its database was restored from a backup or copied). Rows not yet sent go up under the new stream; what the hub holds
 * under the old one stays there. Nothing is deleted.
 */
export const resetSyncStream = defineCommand({
  type: 'ResetSyncStream',
  schema: resetSyncStreamSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx) {
    if (!linkRow(ctx.db).device_key) throw new PosError('INVALID_STATE', 'This outlet is not connected to a hub. Connect it in Settings › Online orders first.');
    const before = syncStream(ctx.db).streamId;
    const streamId = randomBytes(16).toString('hex');
    ctx.db.prepare('UPDATE sync_state SET stream_id = ?, started_at = ? WHERE id = 1').run(streamId, ctx.nowIso);
    ctx.audit({ entity: 'sync', entityId: streamId, action: 'sync.reset', before: { streamId: before }, after: { streamId } });
    ctx.emit('system', 'sync.changed', { streamId });
    return { result: { streamId } };
  },
});

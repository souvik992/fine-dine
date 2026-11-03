import { revokeDeviceSchema } from '@dinepos/shared';
import { MASTER_DEVICE_ID } from '../auth/devices.js';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/**
 * Cuts a device off at once (docs/07, P2-02): its token stops working (the row stays for the audit trail), its
 * sign-ins end and its live connection is closed when the command commits (`device.revoked`).
 */
export const revokeDevice = defineCommand({
  type: 'RevokeDevice',
  schema: revokeDeviceSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    if (p.deviceId === MASTER_DEVICE_ID) throw new PosError('INVALID_STATE', 'The master PC cannot be revoked; it is the server itself.');
    const d = db.prepare('SELECT name, revoked_at FROM device WHERE id = ?').get(p.deviceId) as { name: string; revoked_at: string | null } | undefined;
    if (!d) throw new PosError('NOT_FOUND', 'That device does not exist.', { deviceId: p.deviceId });
    if (d.revoked_at) throw new PosError('INVALID_STATE', `${d.name} is already revoked.`);
    if (ctx.actor.deviceId === p.deviceId) throw new PosError('INVALID_STATE', 'A device cannot revoke itself. Do it from another terminal.');
    db.prepare('UPDATE device SET revoked_at = ?, token_hash = NULL WHERE id = ?').run(ctx.nowIso, p.deviceId);
    const ended = db.prepare('DELETE FROM user_session WHERE device_id = ?').run(p.deviceId).changes;
    ctx.audit({ entity: 'device', entityId: p.deviceId, action: 'device.revoke', before: { name: d.name }, after: { revoked: true, sessionsEnded: ended } });
    ctx.emit('system', 'device.revoked', { deviceId: p.deviceId });
    return { result: { deviceId: p.deviceId, sessionsEnded: ended } };
  },
});

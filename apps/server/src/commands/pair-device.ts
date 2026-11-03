import { newId, pairDeviceSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/**
 * Approves a new device by the 6-digit code it shows (docs/07, P2-02). Always needs a manager's PIN, even for a
 * manager: a paired device can read every order. The device collects its token itself (only it has the secret).
 */
export const pairDevice = defineCommand({
  type: 'PairDevice',
  schema: pairDeviceSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    const { db } = ctx;
    const req = db.prepare(`SELECT id, device_name, kind, remote_addr FROM pairing_request WHERE code = ? AND status = 'pending' AND expires_at > ?`).get(p.code, ctx.nowIso) as
      | { id: string; device_name: string; kind: 'terminal' | 'captain' | 'kds'; remote_addr: string | null }
      | undefined;
    if (!req) throw new PosError('NOT_FOUND', 'No device is waiting with that code. Codes last 10 minutes; ask for a new one on the device.', { code: p.code });
    const approver = ctx.approve({ right: 'admin' }, 'Pairing a device needs a manager PIN.');
    const deviceId = newId();
    const name = p.name ?? req.device_name;
    db.prepare('INSERT INTO device (id, name, kind, paired_at) VALUES (?, ?, ?, ?)').run(deviceId, name, req.kind, ctx.nowIso);
    db.prepare(`UPDATE pairing_request SET status = 'approved', approved_by = ?, approved_at = ?, device_id = ? WHERE id = ?`).run(approver, ctx.nowIso, deviceId, req.id);
    ctx.audit({ entity: 'device', entityId: deviceId, action: 'device.pair', after: { name, kind: req.kind, remoteAddr: req.remote_addr } });
    ctx.emit('system', 'device.paired', { deviceId, name });
    return { result: { deviceId, name, kind: req.kind } };
  },
});

import { newId, pairDeviceSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { pairedCount } from '../routes/licence.js';

/**
 * Approves a new device by the 6-digit code it shows (docs/07, P2-02). Always needs a manager's PIN, even for a
 * manager: a paired device can read every order. The device collects its token itself (only it has the secret).
 */
const SEAT_NAME = { terminal: 'billing terminals', captain: 'captain phones', kds: 'kitchen screens' } as const;
const SEAT_KEY = { terminal: 'terminals', captain: 'captains', kds: 'kds' } as const;

/** P2-09 (docs/07 "Seats enforced at device pairing"): the master PC counts as one terminal; revoked devices free a seat. */
function refuseOverSeats(ctx: CommandContext, kind: 'terminal' | 'captain' | 'kds'): void {
  const seats = ctx.licence.seats(ctx.db, ctx.now);
  if (!seats) return; // development run
  const paired = pairedCount(ctx.db, kind);
  const used = paired + (kind === 'terminal' ? 1 : 0);
  const allowed = seats[SEAT_KEY[kind]];
  if (used >= allowed) {
    throw new PosError('INVALID_STATE', `The licence allows ${allowed} ${SEAT_NAME[kind]}${kind === 'terminal' ? ' (the master PC included)' : ''} and all are in use. Revoke one in Settings › Devices, or ask for more seats.`, {
      reason: 'seats',
      kind,
      allowed,
      used,
    });
  }
}

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
    refuseOverSeats(ctx, req.kind);
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

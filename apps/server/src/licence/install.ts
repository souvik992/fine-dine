// Storing a checked licence key (P2-09 InstallLicence, P4-05 RenewLicence). The key itself is not written to the audit log.
import { currentBusinessDate, openNextBusinessDay } from '../core/business-day.js';
import type { CommandContext } from '../core/context.js';
import { PosError } from '../core/errors.js';
import { licenceStatus, type LicencePayload } from './licence.js';

/** The key verified for this PC and still usable (not past its grace), or a VALIDATION error saying why not. */
export function checkedKey(ctx: CommandContext, key: string): { payload: LicencePayload; state: string } {
  if (!ctx.licence.enforced) throw new PosError('INVALID_STATE', 'Licences are not checked in a development run.');
  const verified = ctx.licence.verify(key);
  if (!verified.ok) throw new PosError('VALIDATION', verified.reason, { field: 'key' });
  const status = licenceStatus(verified, ctx.now, ctx.licence.hardwareId);
  if (!status.canOpenDay) throw new PosError('VALIDATION', `This key ended on ${verified.payload.expiresAt.slice(0, 10)}. Ask for a renewed key.`, { field: 'key' });
  return { payload: verified.payload, state: status.state };
}

/** Stores the key; when no business day is open (the licence was missing or expired) a new one opens at once. */
export function storeLicenceKey(ctx: CommandContext, key: string, checked: { payload: LicencePayload; state: string }, action: 'licence.install' | 'licence.renew') {
  const before = ctx.db.prepare('SELECT licence_key FROM licence WHERE id = 1').pluck().get() as string | null;
  ctx.db.prepare('UPDATE licence SET licence_key = ?, installed_at = ?, installed_by = ? WHERE id = 1').run(key.replace(/\s+/g, ''), ctx.nowIso, ctx.actor.userId);
  const { licensee, expiresAt, seats, hardwareId } = checked.payload;
  ctx.audit({ entity: 'licence', entityId: 'licence', action, before: { hadKey: before !== null }, after: { licensee, expiresAt, seats, hardwareId } });

  let opened: string | null = null;
  if (!currentBusinessDate(ctx.db)) {
    opened = openNextBusinessDay(ctx.db, ctx.timeZone, ctx.now, action === 'licence.renew' ? 'licence renewed' : 'licence installed');
    ctx.emit('system', 'day.changed', { businessDate: opened, closedDate: null });
  }
  ctx.emit('system', 'licence.changed', { state: checked.state });
  return { licensee, expiresAt, seats, state: checked.state, openedBusinessDate: opened };
}

import { installLicenceSchema } from '@dinepos/shared';
import { currentBusinessDate, openNextBusinessDay } from '../core/business-day.js';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { licenceStatus } from '../licence/licence.js';

/**
 * Installs the vendor's licence key (P2-09, docs/07). It must be genuine, issued for this PC and not past its grace;
 * when no business day is open (the licence was missing or expired) a new one opens at once. The key itself is not
 * written to the audit log.
 */
export const installLicence = defineCommand({
  type: 'InstallLicence',
  schema: installLicenceSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    if (!ctx.licence.enforced) throw new PosError('INVALID_STATE', 'Licences are not checked in a development run.');
    const verified = ctx.licence.verify(p.key);
    if (!verified.ok) throw new PosError('VALIDATION', verified.reason, { field: 'key' });
    const status = licenceStatus(verified, ctx.now, ctx.licence.hardwareId);
    if (!status.canOpenDay) throw new PosError('VALIDATION', `This key ended on ${verified.payload.expiresAt.slice(0, 10)}. Ask for a renewed key.`, { field: 'key' });

    const before = ctx.db.prepare('SELECT licence_key FROM licence WHERE id = 1').pluck().get() as string | null;
    ctx.db.prepare('UPDATE licence SET licence_key = ?, installed_at = ?, installed_by = ? WHERE id = 1').run(p.key.replace(/\s+/g, ''), ctx.nowIso, ctx.actor.userId);
    const { licensee, expiresAt, seats, hardwareId } = verified.payload;
    ctx.audit({ entity: 'licence', entityId: 'licence', action: 'licence.install', before: { hadKey: before !== null }, after: { licensee, expiresAt, seats, hardwareId } });

    let opened: string | null = null;
    if (!currentBusinessDate(ctx.db)) {
      opened = openNextBusinessDay(ctx.db, ctx.timeZone, ctx.now, 'licence installed');
      ctx.emit('system', 'day.changed', { businessDate: opened, closedDate: null });
    }
    ctx.emit('system', 'licence.changed', { state: status.state });
    return { result: { licensee, expiresAt, seats, state: status.state, openedBusinessDate: opened } };
  },
});

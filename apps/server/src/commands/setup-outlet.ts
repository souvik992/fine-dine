import { OWNER_ROLE_ID, setupOutletSchema } from '@dinepos/shared';
import { hashPin } from '../auth/pin.js';
import { staffCount } from '../auth/sessions.js';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { setConfigValue } from '../core/outlet-config.js';

/**
 * First-run setup (like Tiffin POS's Setup screen): names the outlet and creates the owner. Accepted without a
 * session only while no staff exist (auth/authenticate.ts); refused once anyone exists.
 */
export const setupOutlet = defineCommand({
  type: 'SetupOutlet',
  schema: setupOutletSchema,
  right: null,
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx, p) {
    if (staffCount(ctx.db) > 0) throw new PosError('INVALID_STATE', 'DinePOS is already set up. Sign in to change settings.');
    ctx.db
      .prepare('INSERT INTO app_user (id, name, role_id, pin_hash, active) VALUES (?, ?, ?, ?, 1)')
      .run(p.ownerId, p.ownerName, OWNER_ROLE_ID, hashPin(p.pin));
    setConfigValue(ctx.db, 'outlet.name', p.outletName);
    ctx.audit({ entity: 'user', entityId: p.ownerId, action: 'setup.owner', after: { name: p.ownerName, roleId: OWNER_ROLE_ID, outletName: p.outletName } });
    ctx.emit('system', 'config.changed', { keys: ['outlet.name'] });
    return { result: { ownerId: p.ownerId } };
  },
});

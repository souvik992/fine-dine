import { unlinkOnlineHubSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';

/**
 * Disconnects from the order hub (P4-06). Refused while online orders are still open (contract F15): finish or reject
 * them first. The hub stops seeing the store; the device key is forgotten.
 */
export const unlinkOnlineHub = defineCommand({
  type: 'UnlinkOnlineHub',
  schema: unlinkOnlineHubSchema,
  right: 'admin',
  needsOrder: false,
  allowWhenDayClosed: true,
  apply(ctx) {
    const open = ctx.db.prepare(`SELECT count(*) FROM online_order WHERE state NOT IN ('REJECTED', 'AUTO_REJECTED', 'CANCELLED', 'DELIVERED', 'PICKED_UP')`).pluck().get() as number;
    if (open > 0) throw new PosError('INVALID_STATE', `${open} online order${open === 1 ? ' is' : 's are'} still open. Finish or reject ${open === 1 ? 'it' : 'them'} first.`, { open });
    ctx.db.prepare('UPDATE online_link SET hub_url = NULL, device_key = NULL, store_slug = NULL, store_name = NULL, last_seq = 0, menu_hash = NULL, menu_version = 0 WHERE id = 1').run();
    ctx.audit({ entity: 'online_link', entityId: 'hub', action: 'online.unpair' });
    ctx.emit(['online', 'system'], 'online.linked', { store: null });
    return { result: { unlinked: true } };
  },
});

import { renewLicenceSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { checkedKey, storeLicenceKey } from '../licence/install.js';

/**
 * Internal (P4-05): a licence key the vendor put on the hub, fetched by the sync agent. Installed like InstallLicence,
 * but only when it is for this PC and ends later than the key installed now: a renewal never shortens a licence.
 */
export const renewLicence = defineCommand({
  type: 'RenewLicence',
  schema: renewLicenceSchema,
  right: null,
  needsOrder: false,
  allowWhenDayClosed: true,
  internal: true,
  apply(ctx, p) {
    const key = p.key.replace(/\s+/g, '');
    const current = ctx.db.prepare('SELECT licence_key FROM licence WHERE id = 1').pluck().get() as string | null;
    if (current === key) return { result: { status: 'already installed' } };
    const checked = checkedKey(ctx, key);
    const now = current ? ctx.licence.verify(current) : null;
    if (now?.ok && Date.parse(checked.payload.expiresAt) <= Date.parse(now.payload.expiresAt)) {
      throw new PosError('INVALID_STATE', `The key on the hub ends on ${checked.payload.expiresAt.slice(0, 10)}, not later than the key installed here.`, { expiresAt: checked.payload.expiresAt });
    }
    return { result: { status: 'renewed', ...storeLicenceKey(ctx, key, checked, 'licence.renew') } };
  },
});

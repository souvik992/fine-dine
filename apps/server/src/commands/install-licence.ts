import { installLicenceSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { checkedKey, storeLicenceKey } from '../licence/install.js';

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
    return { result: storeLicenceKey(ctx, p.key, checkedKey(ctx, p.key), 'licence.install') };
  },
});

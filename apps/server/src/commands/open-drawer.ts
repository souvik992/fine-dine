import { openDrawerSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { PosError } from '../core/errors.js';
import { printCashSlip } from './cash-support.js';

/** Opens the cash drawer without a sale (docs/03): a slip with the reason, audited as leakage; PIN per role. */
export const openDrawer = defineCommand({
  type: 'OpenDrawer',
  schema: openDrawerSchema,
  right: 'drawer.open',
  needsOrder: false,
  apply(ctx, p) {
    const printerId = printCashSlip(ctx, 'drawer', p.reason, null);
    if (!printerId) throw new PosError('INVALID_STATE', 'No bill printer is set up; the cash drawer is opened through it. Add one in Settings, Kitchen & printers.');
    ctx.audit({ entity: 'drawer', entityId: printerId, action: 'drawer.open', reason: p.reason, leakage: true });
    return { result: { printerId } };
  },
});

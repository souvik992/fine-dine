import { reprintKotSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { reprintKot as reprint } from './kot-support.js';

/** Prints a KOT again exactly as first printed, marked DUPLICATE (docs/03). Leakage flag; PIN per role. */
export const reprintKot = defineCommand({
  type: 'ReprintKOT',
  schema: reprintKotSchema,
  right: 'reprint',
  needsOrder: false,
  apply(ctx, p) {
    const kot = reprint(ctx, p.kotId);
    ctx.audit({ entity: 'kot', entityId: p.kotId, action: 'kot.reprint', after: { kotNo: kot.kotNo, orderId: kot.orderId }, leakage: true });
    return { result: { kotId: p.kotId, kotNo: kot.kotNo } };
  },
});

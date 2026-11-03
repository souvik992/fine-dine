import { payInSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { printCashSlip, recordCash } from './cash-support.js';

/** Cash put into the drawer (float, change from the bank). Counted in the day-end cash; prints a slip and opens the drawer. */
export const payIn = defineCommand({
  type: 'PayIn',
  schema: payInSchema,
  right: 'cash.move',
  needsOrder: false,
  apply(ctx, p) {
    const id = recordCash(ctx, 'pay_in', p.amountPaise, p.reason);
    const printerId = printCashSlip(ctx, 'pay_in', p.reason, p.amountPaise);
    ctx.audit({ entity: 'cash_movement', entityId: id, action: 'cash.pay_in', after: { amountPaise: p.amountPaise }, reason: p.reason });
    return { result: { id, printerId } };
  },
});

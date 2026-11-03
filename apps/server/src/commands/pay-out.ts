import { payOutSchema } from '@dinepos/shared';
import { defineCommand } from '../core/command-handler.js';
import { printCashSlip, recordCash } from './cash-support.js';

/**
 * Cash taken out of the drawer (petty expenses, a supplier paid in cash). Taken off the day-end cash expected;
 * prints a slip with a line to sign and opens the drawer. Leakage flag (cash leaving without a sale).
 */
export const payOut = defineCommand({
  type: 'PayOut',
  schema: payOutSchema,
  right: 'cash.move',
  needsOrder: false,
  apply(ctx, p) {
    const id = recordCash(ctx, 'pay_out', p.amountPaise, p.reason);
    const printerId = printCashSlip(ctx, 'pay_out', p.reason, p.amountPaise);
    ctx.audit({ entity: 'cash_movement', entityId: id, action: 'cash.pay_out', after: { amountPaise: p.amountPaise }, reason: p.reason, leakage: true });
    return { result: { id, printerId } };
  },
});

// What a guest pays with (Settle, and a cash-on-delivery online order when it is delivered or collected).
// Its own file: billing.ts and online.ts both use it, and billing.ts already imports online.ts.
import { z } from 'zod';

export const TENDER_MODES = ['cash', 'card', 'upi', 'due', 'complimentary', 'other'] as const;
export type TenderMode = (typeof TENDER_MODES)[number];
/** Every payment mode stored: what a cashier can take, plus 'online' (paid on the website or app, P4-06). */
export type PaymentMode = TenderMode | 'online';

/** One line per mode (split payment). Only cash may exceed the bill (change). */
export const tendersSchema = z
  .array(
    z
      .object({
        mode: z.enum(TENDER_MODES),
        amountPaise: z.number().int().min(0).max(100_000_000_000).refine((n) => n > 0, 'amount must be more than zero'),
        /** Card slip / UPI reference, or the reason for a complimentary bill. */
        ref: z.string().trim().min(1).max(60).nullable().default(null),
      })
      .strict(),
  )
  .min(1)
  .max(10);

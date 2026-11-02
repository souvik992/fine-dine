// Payload schemas for PrintBill, Settle, DayEnd and SetConfig (docs/03-command-api.md).
import { z } from 'zod';
import { gstinProblem } from '../../gstin.js';
import { BILL_PREFIX_RE } from '../../numbering.js';
import { billDisplaySchema, billLogoSchema } from '../../bill-display.js';
import { ulidSchema } from '../envelope.js';

const paise = z.number().int().min(0).max(100_000_000_000);
const text = (max: number) => z.string().trim().min(1).max(max);
const gstin = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .superRefine((g, ctx) => {
    const problem = gstinProblem(g);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const printBillSchema = z
  .object({
    /** pct: value in basis points (1000 = 10%); amount: value in paise. A reason is required when value > 0. */
    discount: z
      .object({ kind: z.enum(['pct', 'amount']), value: z.number().int().min(0), reason: text(80).nullable().default(null) })
      .strict()
      .refine((d) => d.kind !== 'pct' || d.value <= 10_000, { message: 'percent discount cannot exceed 100%', path: ['value'] })
      .refine((d) => d.value === 0 || d.reason !== null, { message: 'a discount needs a reason', path: ['reason'] })
      .nullable()
      .default(null),
    /** Off unless the guest accepts it (CCPA guidance); rateBp falls back to the outlet setting. */
    serviceCharge: z
      .object({ enabled: z.boolean(), rateBp: z.number().int().min(0).max(2_000).optional() })
      .strict()
      .nullable()
      .default(null),
    customer: z
      .object({
        name: text(60).nullable().default(null),
        phone: z.string().trim().regex(/^\+?[0-9 -]{6,16}$/, 'not a phone number').nullable().default(null),
        gstin: gstin.nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();

export const TENDER_MODES = ['cash', 'card', 'upi', 'due', 'complimentary', 'other'] as const;
export type TenderMode = (typeof TENDER_MODES)[number];

export const settleSchema = z
  .object({
    billId: ulidSchema,
    tenders: z
      .array(
        z
          .object({
            mode: z.enum(TENDER_MODES),
            amountPaise: paise.refine((n) => n > 0, 'amount must be more than zero'),
            /** Card slip / UPI reference, or the reason for a complimentary bill. */
            ref: text(60).nullable().default(null),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .refine((s) => s.tenders.every((t) => t.mode !== 'complimentary' || t.ref !== null), {
    message: 'a complimentary bill needs a reason in ref',
    path: ['tenders'],
  });

/** SplitBill (docs/03, docs/08 "Split bills"): on a printed bill; each part becomes its own numbered bill. */
export const splitBillSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('equal'), parts: z.number().int().min(2).max(20) }).strict(),
  z.object({ mode: z.literal('proportion'), parts: z.array(z.object({ weight: z.number().int().min(1).max(100) }).strict()).min(2).max(20) }).strict(),
  z
    .object({
      mode: z.literal('items'),
      /** Every billed line's whole quantity must be assigned; a line may be shared (2 naan here, 1 there). */
      parts: z
        .array(z.object({ items: z.array(z.object({ orderItemId: ulidSchema, qty: z.number().int().min(1).max(999) }).strict()).min(1).max(200) }).strict())
        .min(2)
        .max(20),
    })
    .strict(),
]);

export const dayEndSchema = z.object({ cashCountedPaise: paise }).strict();

/** Outlet settings stored in the `config` table (one JSON value per key). */
export const configSchemas = {
  'outlet.name': text(60),
  'outlet.addressLines': z.array(text(48)).max(4),
  'outlet.gstin': gstin.nullable(),
  'outlet.fssai': z.string().trim().regex(/^\d{14}$/, 'FSSAI licence numbers have 14 digits').nullable(),
  'outlet.phone': z.string().trim().max(32).nullable(),
  'bill.prefix': z.string().trim().regex(BILL_PREFIX_RE, '1 to 3 capital letters or digits'),
  'bill.footerLines': z.array(text(48)).max(3),
  'bill.roundOffStep': z.union([z.literal(0), z.literal(50), z.literal(100)]),
  'bill.roundOffTie': z.enum(['up', 'down']),
  'bill.serviceChargeBp': z.number().int().min(0).max(2_000),
  'bill.upiVpa': z.string().trim().regex(/^[\w.-]{2,64}@[\w.-]{2,64}$/, 'not a UPI id').nullable(),
  'bill.upiPayeeName': z.string().trim().max(40).nullable(),
  'bill.printerId': ulidSchema.nullable(),
  'bill.display': billDisplaySchema,
  'bill.logo': billLogoSchema.nullable(),
  'kot.default_station_id': ulidSchema.nullable(),
} as const;

export type ConfigKey = keyof typeof configSchemas;
export type OutletConfig = { [K in ConfigKey]: z.infer<(typeof configSchemas)[K]> };

export const setConfigSchema = z
  .object({ values: z.object(configSchemas).partial().strict() })
  .strict()
  .refine((p) => Object.keys(p.values).length > 0, { message: 'nothing to change' });

export type PrintBillPayload = z.infer<typeof printBillSchema>;
export type SettlePayload = z.infer<typeof settleSchema>;
export type DayEndPayload = z.infer<typeof dayEndSchema>;
export type SplitBillPayload = z.infer<typeof splitBillSchema>;
export type SetConfigPayload = z.infer<typeof setConfigSchema>;

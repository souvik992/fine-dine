// Staff, roles, sign-in and first-run setup (docs/07 "Users and PINs", "Rights").
import { z } from 'zod';
import { RIGHTS } from '../../rights.js';
import { ulidSchema } from '../envelope.js';

/** 4 to 6 digits (docs/07). */
export const pinSchema = z.string().regex(/^\d{4,6}$/, 'a PIN has 4 to 6 digits');
const personName = z.string().trim().min(1).max(40);

/** First run only: creates the owner and names the outlet. Allowed without a session while no staff exist. */
export const setupOutletSchema = z
  .object({ outletName: z.string().trim().min(1).max(60), ownerId: ulidSchema, ownerName: personName, pin: pinSchema })
  .strict();

export const upsertUserSchema = z
  .object({
    id: ulidSchema,
    name: personName,
    roleId: ulidSchema,
    /** Required for a new person; on an existing one, sets a new PIN. */
    pin: pinSchema.optional(),
    active: z.boolean().default(true),
  })
  .strict();

export const upsertRoleSchema = z
  .object({
    id: ulidSchema,
    name: z.string().trim().min(1).max(30),
    /** Highest bill discount without a manager PIN, in basis points (1000 = 10%). */
    discountLimitBp: z.number().int().min(0).max(10_000),
    rights: z
      .array(z.object({ right: z.enum(RIGHTS), needsPin: z.boolean().default(false) }).strict())
      .max(RIGHTS.length)
      .refine((r) => new Set(r.map((x) => x.right)).size === r.length, 'a right is listed twice'),
  })
  .strict();

export const loginSchema = z.object({ userId: ulidSchema, pin: pinSchema }).strict();

export type SetupOutletPayload = z.infer<typeof setupOutletSchema>;
export type UpsertUserPayload = z.infer<typeof upsertUserSchema>;
export type UpsertRolePayload = z.infer<typeof upsertRoleSchema>;

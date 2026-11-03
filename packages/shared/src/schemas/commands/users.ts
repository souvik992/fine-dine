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

// ---- devices (P2-02, docs/07 "Device pairing") ----

/** Approves the device showing this 6-digit code; the name is what the Devices list will show. Manager PIN. */
export const pairDeviceSchema = z
  .object({ code: z.string().regex(/^\d{6}$/, 'the 6-digit code shown on the new device'), name: z.string().trim().min(1).max(40).optional() })
  .strict();
/** Cuts a device off at once: its token stops working, its sign-ins end and its live connection closes. */
export const revokeDeviceSchema = z.object({ deviceId: ulidSchema }).strict();
